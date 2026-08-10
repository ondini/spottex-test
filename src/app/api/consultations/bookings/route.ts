import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { generateToken, hashClientAddress, hashToken } from "@/lib/crypto";
import { hostCalendarHasConflict } from "@/lib/consultation/google-calendar";
import { isCalendarDisconnecting, lockHostCalendarState } from "@/lib/consultation/calendar-state";
import { queueBookingVerification, releaseExpiredConsultationHolds } from "@/lib/consultation/service";
import { prisma } from "@/lib/prisma";
import { clientAddress, consumeRateLimit } from "@/lib/security/rate-limit";

const HOLD_MINUTES = 30;

const bookingSchema = z.object({
  slotId: z.number().int().positive(),
  guestName: z.string().trim().min(2).max(160),
  guestEmail: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  guestPhone: z.string().trim().max(50).optional().nullable(),
  note: z.string().trim().max(2_000).optional().nullable(),
  consent: z.literal(true),
  website: z.string().max(0).optional(),
});

export async function POST(request: NextRequest) {
  const parsed = bookingSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  if (parsed.data.website) return NextResponse.json({ ok: true }, { status: 201 });

  const [addressLimit, emailLimit, slotLimit] = await Promise.all([
    consumeRateLimit(request, { scope: "consultation-book-address", limit: 5, windowMs: 10 * 60_000 }),
    consumeRateLimit(request, { scope: "consultation-book-email", identity: parsed.data.guestEmail, includeAddress: false, limit: 3, windowMs: 24 * 60 * 60_000 }),
    consumeRateLimit(request, { scope: "consultation-book-slot", identity: parsed.data.slotId, includeAddress: false, limit: 12, windowMs: 60 * 60_000 }),
  ]);
  const limited = [addressLimit, emailLimit, slotLimit].find((result) => !result.allowed);
  if (limited) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });
  const ipHash = hashClientAddress(clientAddress(request));

  await releaseExpiredConsultationHolds();
  const verifyToken = generateToken();
  const manageToken = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + HOLD_MINUTES * 60_000);

  const candidate = await prisma.consultationSlot.findFirst({
    where: { id: parsed.data.slotId, status: "OPEN", startUtc: { gt: now } },
    select: { id: true, hostUserId: true, startUtc: true, endUtc: true },
  });
  if (!candidate) return NextResponse.json({ error: "SLOT_TAKEN" }, { status: 409 });
  try {
    if (await hostCalendarHasConflict(candidate.hostUserId, candidate.startUtc, candidate.endUtc)) {
      await prisma.consultationSlot.updateMany({ where: { id: candidate.id, status: "OPEN" }, data: { status: "BLOCKED" } });
      return NextResponse.json({ error: "SLOT_TAKEN" }, { status: 409 });
    }
  } catch (error) {
    console.error("Google Calendar booking check failed closed", error);
    return NextResponse.json({ error: "CALENDAR_UNAVAILABLE" }, { status: 503 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const calendarState = await lockHostCalendarState(tx, candidate.hostUserId);
      if (isCalendarDisconnecting(calendarState?.metadata)) throw new Error("CALENDAR_DISCONNECTING");
      const claimed = await tx.$executeRaw`
        UPDATE consultation.consultation_slot
        SET status = 'HELD', "holdExpiresAt" = ${expiresAt}, "updatedAt" = now()
        WHERE id = ${parsed.data.slotId} AND status = 'OPEN' AND "startUtc" > ${now}
      `;
      if (!claimed) throw new Error("SLOT_TAKEN");
      const slot = await tx.consultationSlot.findUnique({ where: { id: parsed.data.slotId }, select: { startUtc: true } });
      if (!slot) throw new Error("SLOT_TAKEN");
      const booking = await tx.consultationBooking.create({
        data: {
          slotId: parsed.data.slotId,
          guestName: parsed.data.guestName,
          guestEmail: parsed.data.guestEmail,
          guestPhone: parsed.data.guestPhone || null,
          note: parsed.data.note || null,
          status: "PENDING",
          verifyTokenHash: hashToken(verifyToken),
          manageTokenHash: hashToken(manageToken),
          manageTokenExpiresAt: expiresAt,
          consentAt: now,
          clientIpHash: ipHash,
          metadata: { verifyExpiresAt: expiresAt.toISOString() },
        },
        select: { id: true },
      });
      await queueBookingVerification({
        bookingId: booking.id,
        email: parsed.data.guestEmail,
        name: parsed.data.guestName,
        startUtc: slot.startUtc,
        verifyToken,
        db: tx,
      });
      return { bookingId: booking.id, startUtc: slot.startUtc };
    });
    return NextResponse.json({ ok: true, bookingId: result.bookingId }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "SLOT_TAKEN") return NextResponse.json({ error: "SLOT_TAKEN" }, { status: 409 });
    if (error instanceof Error && error.message === "CALENDAR_DISCONNECTING") return NextResponse.json({ error: "CALENDAR_UNAVAILABLE" }, { status: 503 });
    console.error("Consultation booking failed", error);
    return NextResponse.json({ error: "BOOKING_FAILED" }, { status: 500 });
  }
}
