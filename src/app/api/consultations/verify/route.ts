import { NextRequest, NextResponse } from "next/server";

import { generateToken, hashToken } from "@/lib/crypto";
import { enqueueCalendarCreate, processConsultationCalendarJobs } from "@/lib/consultation/calendar-sync";
import { hostCalendarHasConflict } from "@/lib/consultation/google-calendar";
import { isCalendarDisconnecting, lockHostCalendarState } from "@/lib/consultation/calendar-state";
import {
  publicBaseUrl,
  queueBookingConfirmation,
  queueConsultationReminder,
  queueHostBookingNotice,
} from "@/lib/consultation/service";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function resultUrl(result: string) {
  return new URL(`/konzultace/potvrzeno?${result}`, publicBaseUrl());
}

function redirectResult(result: string, status: 303 | 307 = 307) {
  return NextResponse.redirect(resultUrl(result), status);
}

function redirectConfirmation(token: string) {
  const url = resultUrl("");
  url.searchParams.set("token", token);
  return NextResponse.redirect(url, 307);
}

function redirectCalendarRetry(token: string) {
  const url = resultUrl("error=calendar");
  url.searchParams.set("token", token);
  return NextResponse.redirect(url, 303);
}

function readBooking(token: string) {
  return prisma.consultationBooking.findUnique({
    where: { verifyTokenHash: hashToken(token) },
    include: { slot: true },
  });
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token || token.length > 200) return redirectResult("error=missing");
  const booking = await readBooking(token);
  if (!booking) return redirectResult("error=invalid");
  if (booking.status === "CONFIRMED") return redirectResult(`booking=${booking.id}`);
  if (booking.status !== "PENDING" || booking.slot.status !== "HELD" || !booking.slot.holdExpiresAt || booking.slot.holdExpiresAt <= new Date()) {
    return redirectResult("error=expired");
  }
  return redirectConfirmation(token);
}

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const token = form?.get("token");
  if (typeof token !== "string" || !token || token.length > 200) {
    return redirectResult("error=missing", 303);
  }
  const booking = await readBooking(token);
  if (!booking) return redirectResult("error=invalid", 303);
  if (booking.status === "CONFIRMED") return redirectResult(`booking=${booking.id}`, 303);
  if (booking.status !== "PENDING" || booking.slot.status !== "HELD" || !booking.slot.holdExpiresAt || booking.slot.holdExpiresAt <= new Date()) {
    return redirectResult("error=expired", 303);
  }

  try {
    if (await hostCalendarHasConflict(booking.slot.hostUserId, booking.slot.startUtc, booking.slot.endUtc)) {
      await prisma.$transaction(async (tx) => {
        const expired = await tx.consultationBooking.updateMany({
          where: { id: booking.id, slotId: booking.slotId, status: "PENDING" },
          data: { status: "EXPIRED" },
        });
        const blocked = await tx.consultationSlot.updateMany({
          where: { id: booking.slotId, status: "HELD", holdExpiresAt: { gt: new Date() } },
          data: { status: "BLOCKED", holdExpiresAt: null },
        });
        if (!expired.count || !blocked.count) throw new Error("BOOKING_CHANGED");
      });
      return redirectResult("error=slot-conflict", 303);
    }
  } catch (error) {
    if (error instanceof Error && error.message === "BOOKING_CHANGED") {
      return redirectResult("error=expired", 303);
    }
    console.error("Google Calendar confirmation check failed closed", error);
    return redirectCalendarRetry(token);
  }

  const freshManageToken = generateToken();
  const manageTokenExpiresAt = new Date(booking.slot.endUtc.getTime() + 7 * 86_400_000);
  let calendarJobId: string;
  try {
    calendarJobId = await prisma.$transaction(async (tx) => {
      const calendarState = await lockHostCalendarState(tx, booking.slot.hostUserId);
      if (isCalendarDisconnecting(calendarState?.metadata)) throw new Error("CALENDAR_DISCONNECTING");
      const slotUpdated = await tx.$executeRaw`
        UPDATE consultation.consultation_slot
        SET status = 'BOOKED', "holdExpiresAt" = NULL, "updatedAt" = now()
        WHERE id = ${booking.slotId} AND status = 'HELD' AND "holdExpiresAt" > now()
      `;
      const bookingUpdated = await tx.consultationBooking.updateMany({
        where: { id: booking.id, status: "PENDING" },
        data: {
          status: "CONFIRMED",
          emailVerifiedAt: new Date(),
          manageTokenHash: hashToken(freshManageToken),
          manageTokenExpiresAt,
          calendarRevision: { increment: 1 },
        },
      });
      if (!slotUpdated || !bookingUpdated.count) throw new Error("EXPIRED");
      const confirmed = await tx.consultationBooking.findUniqueOrThrow({
        where: { id: booking.id },
        select: { calendarRevision: true },
      });
      const job = await enqueueCalendarCreate(tx, {
        bookingId: booking.id,
        slotId: booking.slotId,
        revision: confirmed.calendarRevision,
        calendarId: calendarState?.targetCalendarId || null,
        autoMeet: calendarState?.autoMeet ?? true,
      });
      await queueBookingConfirmation({
        bookingId: booking.id,
        email: booking.guestEmail,
        name: booking.guestName,
        startUtc: booking.slot.startUtc,
        meetUrl: null,
        manageToken: freshManageToken,
        db: tx,
      });
      await queueConsultationReminder({
        bookingId: booking.id,
        email: booking.guestEmail,
        name: booking.guestName,
        startUtc: booking.slot.startUtc,
        meetUrl: null,
        db: tx,
      });
      const host = await tx.user.findUnique({
        where: { id: booking.slot.hostUserId },
        select: { email: true },
      });
      if (host) {
        await queueHostBookingNotice({
          bookingId: booking.id,
          hostEmail: host.email,
          guestName: booking.guestName,
          guestEmail: booking.guestEmail,
          guestPhone: booking.guestPhone,
          note: booking.note,
          startUtc: booking.slot.startUtc,
          db: tx,
        });
      }
      return job.id;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "EXPIRED") return redirectResult("error=expired", 303);
    if (error instanceof Error && error.message === "CALENDAR_DISCONNECTING") return redirectCalendarRetry(token);
    console.error("Consultation verification failed", error);
    return redirectResult("error=invalid", 303);
  }

  try {
    await processConsultationCalendarJobs({ jobIds: [calendarJobId], limit: 1 });
  } catch (error) {
    console.error("Immediate Google Calendar synchronization failed; durable retry remains queued", error);
  }
  return redirectResult(`booking=${booking.id}`, 303);
}
