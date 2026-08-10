import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { hashToken } from "@/lib/crypto";
import {
  enqueueCalendarCreate,
  enqueueCalendarDelete,
  googleCalendarEventId,
  processConsultationCalendarJobs,
  resolveCalendarDeleteCalendarId,
} from "@/lib/consultation/calendar-sync";
import { hostCalendarHasConflict } from "@/lib/consultation/google-calendar";
import { isCalendarDisconnecting, lockHostCalendarState } from "@/lib/consultation/calendar-state";
import {
  cancelPendingConsultationReminders,
  queueBookingConfirmation,
  queueConsultationReminder,
} from "@/lib/consultation/service";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/security/rate-limit";

const schema = z.object({ token: z.string().min(20).max(200), newSlotId: z.number().int().positive() });

export async function POST(request: NextRequest) {
  const limit = await consumeRateLimit(request, { scope: "consultation-reschedule", limit: 15, windowMs: 15 * 60_000 });
  if (!limit.allowed) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const booking = await prisma.consultationBooking.findUnique({
    where: { manageTokenHash: hashToken(parsed.data.token), manageTokenExpiresAt: { gt: new Date() } },
    include: { slot: true },
  });
  if (!booking) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (booking.status !== "CONFIRMED" || booking.slot.startUtc.getTime() <= Date.now() + 2 * 60 * 60_000) {
    return NextResponse.json({ error: "NOT_MODIFIABLE" }, { status: 409 });
  }
  if (booking.slotId === parsed.data.newSlotId) return NextResponse.json({ ok: true });

  const candidate = await prisma.consultationSlot.findFirst({
    where: { id: parsed.data.newSlotId, hostUserId: booking.slot.hostUserId, status: "OPEN", startUtc: { gt: new Date(Date.now() + 2 * 60 * 60_000) } },
  });
  if (!candidate) return NextResponse.json({ error: "SLOT_TAKEN" }, { status: 409 });
  try {
    if (await hostCalendarHasConflict(candidate.hostUserId, candidate.startUtc, candidate.endUtc)) {
      await prisma.consultationSlot.updateMany({ where: { id: candidate.id, status: "OPEN" }, data: { status: "BLOCKED" } });
      return NextResponse.json({ error: "SLOT_TAKEN" }, { status: 409 });
    }
  } catch (error) {
    console.error("Google Calendar reschedule check failed closed", error);
    return NextResponse.json({ error: "CALENDAR_UNAVAILABLE" }, { status: 503 });
  }

  let rescheduled;
  try {
    rescheduled = await prisma.$transaction(async (tx) => {
      const calendarState = await lockHostCalendarState(tx, booking.slot.hostUserId);
      if (isCalendarDisconnecting(calendarState?.metadata)) throw new Error("CALENDAR_DISCONNECTING");
      await tx.$executeRaw`SELECT id FROM consultation.consultation_booking WHERE id = ${booking.id} FOR UPDATE`;
      const current = await tx.consultationBooking.findUniqueOrThrow({
        where: { id: booking.id },
        include: { slot: true },
      });
      if (current.status !== "CONFIRMED" || current.slotId !== booking.slotId) throw new Error("BOOKING_CHANGED");
      const claimed = await tx.$executeRaw`
        UPDATE consultation.consultation_slot
        SET status = 'BOOKED', "updatedAt" = now()
        WHERE id = ${parsed.data.newSlotId}
          AND status = 'OPEN'
          AND "startUtc" > now() + interval '2 hours'
          AND "hostUserId" = ${current.slot.hostUserId}
      `;
      if (!claimed) throw new Error("SLOT_TAKEN");
      const next = await tx.consultationSlot.findUnique({ where: { id: parsed.data.newSlotId } });
      if (!next) throw new Error("SLOT_TAKEN");
      const nextRevision = current.calendarRevision + 1;
      const changed = await tx.consultationBooking.updateMany({
        where: {
          id: current.id,
          status: "CONFIRMED",
          slotId: current.slotId,
          calendarRevision: current.calendarRevision,
        },
        data: {
          slotId: next.id,
          manageTokenExpiresAt: new Date(next.endUtc.getTime() + 7 * 86_400_000),
          calendarRevision: { increment: 1 },
        },
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
      const jobIds: string[] = [];
      if (oldCalendarId && oldEventId) {
        const deleteJob = await enqueueCalendarDelete(tx, {
          bookingId: current.id,
          hostUserId: current.slot.hostUserId,
          revision: current.calendarRevision,
          calendarId: oldCalendarId,
          eventId: oldEventId,
        });
        jobIds.push(deleteJob.id);
      }
      const createJob = await enqueueCalendarCreate(tx, {
        bookingId: current.id,
        slotId: next.id,
        revision: nextRevision,
        calendarId: calendarState?.targetCalendarId || null,
        autoMeet: calendarState?.autoMeet ?? true,
      });
      jobIds.push(createJob.id);
      await cancelPendingConsultationReminders(current.id, tx);
      await queueBookingConfirmation({
        bookingId: current.id,
        email: current.guestEmail,
        name: current.guestName,
        startUtc: next.startUtc,
        meetUrl: null,
        manageToken: parsed.data.token,
        db: tx,
      });
      await queueConsultationReminder({
        bookingId: current.id,
        email: current.guestEmail,
        name: current.guestName,
        startUtc: next.startUtc,
        meetUrl: null,
        db: tx,
      });
      return { slot: next, jobIds };
    });
  } catch (error) {
    if (error instanceof Error && ["SLOT_TAKEN", "BOOKING_CHANGED"].includes(error.message)) {
      return NextResponse.json({ error: "SLOT_TAKEN" }, { status: 409 });
    }
    if (error instanceof Error && error.message === "CALENDAR_DISCONNECTING") {
      return NextResponse.json({ error: "CALENDAR_UNAVAILABLE" }, { status: 503 });
    }
    console.error("Consultation rescheduling failed", error);
    return NextResponse.json({ error: "RESCHEDULE_FAILED" }, { status: 500 });
  }

  try {
    await processConsultationCalendarJobs({ jobIds: rescheduled.jobIds, limit: rescheduled.jobIds.length });
  } catch (error) {
    console.error("Immediate Google Calendar reschedule sync failed; durable retry remains queued", error);
  }
  return NextResponse.json({ ok: true });
}
