import { NextRequest, NextResponse } from "next/server";

import { hashToken } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/security/rate-limit";

const MINIMUM_CHANGE_LEAD_MS = 2 * 60 * 60_000;

export async function GET(request: NextRequest) {
  const limit = await consumeRateLimit(request, { scope: "consultation-manage", limit: 30, windowMs: 15 * 60_000 });
  if (!limit.allowed) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "MISSING_TOKEN" }, { status: 400 });
  const booking = await prisma.consultationBooking.findUnique({
    where: { manageTokenHash: hashToken(token), manageTokenExpiresAt: { gt: new Date() } },
    include: { slot: true },
  });
  if (!booking) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({
    booking: {
      id: booking.id,
      status: booking.status,
      slot: {
        id: booking.slot.id,
        startUtc: booking.slot.startUtc,
        endUtc: booking.slot.endUtc,
        meetUrl: booking.slot.meetUrl,
      },
      canModify: booking.status === "CONFIRMED" && booking.slot.startUtc.getTime() > Date.now() + MINIMUM_CHANGE_LEAD_MS,
    },
  });
}
