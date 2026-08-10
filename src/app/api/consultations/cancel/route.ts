import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { hashToken } from "@/lib/crypto";
import {
  enqueueCalendarDelete,
  googleCalendarEventId,
  processConsultationCalendarJobs,
  resolveCalendarDeleteCalendarId,
} from "@/lib/consultation/calendar-sync";
import { lockHostCalendarState } from "@/lib/consultation/calendar-state";
import { cancelPendingConsultationReminders } from "@/lib/consultation/service";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/security/rate-limit";

const schema = z.object({ token: z.string().min(20).max(200) });

export async function POST(request: NextRequest) {
  const limit = await consumeRateLimit(request, { scope: "consultation-cancel", limit: 15, windowMs: 15 * 60_000 });
  if (!limit.allowed) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const booking = await prisma.consultationBooking.findUnique({
    where: { manageTokenHash: hashToken(parsed.data.token) },
    select: { id: true, slot: { select: { hostUserId: true } } },
  });
  if (!booking) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  let canceled;
  try {
    canceled = await prisma.$transaction(async (tx) => {
      await lockHostCalendarState(tx, booking.slot.hostUserId);
      await tx.$executeRaw`SELECT id FROM consultation.consultation_booking WHERE id = ${booking.id} FOR UPDATE`;
      const current = await tx.consultationBooking.findUniqueOrThrow({ where: { id: booking.id }, include: { slot: true } });
      if (current.status === "CANCELED") return { booking: current, jobIds: [] as string[], alreadyCanceled: true };
      if (current.manageTokenExpiresAt <= new Date() || current.status !== "CONFIRMED" || current.slot.startUtc.getTime() <= Date.now() + 2 * 60 * 60_000) {
        throw new Error("TOO_LATE");
      }
      const calendar = await tx.consultationHostCalendar.findUnique({
        where: { hostUserId: current.slot.hostUserId },
        select: { targetCalendarId: true },
      });
      const oldCalendarId = await resolveCalendarDeleteCalendarId(tx, {
        bookingId: current.id,
        revision: current.calendarRevision,
        slotCalendarId: current.slot.googleCalendarId,
        currentTargetCalendarId: calendar?.targetCalendarId || null,
      });
      const oldEventId = current.slot.googleEventId
        || (current.calendarRevision > 0 ? googleCalendarEventId(current.id, current.calendarRevision) : null);
      const changed = await tx.consultationBooking.updateMany({
        where: {
          id: current.id,
          status: "CONFIRMED",
          slotId: current.slotId,
          calendarRevision: current.calendarRevision,
        },
        data: { status: "CANCELED", manageTokenExpiresAt: new Date(), calendarRevision: { increment: 1 } },
      });
      if (!changed.count) throw new Error("BOOKING_CHANGED");
      const released = await tx.consultationSlot.updateMany({
        where: { id: current.slotId, status: "BOOKED" },
        data: {
          status: "OPEN",
          holdExpiresAt: null,
          googleCalendarId: null,
          googleEventId: null,
          meetUrl: null,
        },
      });
      if (!released.count) throw new Error("BOOKING_CHANGED");
      const jobIds: string[] = [];
      if (oldCalendarId && oldEventId) {
        const job = await enqueueCalendarDelete(tx, {
          bookingId: current.id,
          hostUserId: current.slot.hostUserId,
          revision: current.calendarRevision,
          calendarId: oldCalendarId,
          eventId: oldEventId,
        });
        jobIds.push(job.id);
      }
      await cancelPendingConsultationReminders(current.id, tx);
      return { booking: current, jobIds, alreadyCanceled: false };
    });
  } catch (error) {
    if (error instanceof Error && error.message === "TOO_LATE") return NextResponse.json({ error: "TOO_LATE" }, { status: 409 });
    if (error instanceof Error && error.message === "BOOKING_CHANGED") return NextResponse.json({ error: "BOOKING_CHANGED" }, { status: 409 });
    throw error;
  }
  if (canceled.alreadyCanceled) return NextResponse.json({ ok: true });

  try {
    if (canceled.jobIds.length) {
      await processConsultationCalendarJobs({ jobIds: canceled.jobIds, limit: canceled.jobIds.length });
    }
  } catch (error) {
    console.error("Immediate Google Calendar cancellation sync failed; durable retry remains queued", error);
  }
  return NextResponse.json({ ok: true });
}
