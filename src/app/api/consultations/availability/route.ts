import { NextRequest, NextResponse } from "next/server";

import { releaseExpiredConsultationHolds } from "@/lib/consultation/service";
import { prisma } from "@/lib/prisma";
import { listHostBusyIntervals } from "@/lib/consultation/google-calendar";
import { consumeRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

function validDate(value: string | null, fallback: Date) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export async function GET(request: NextRequest) {
  const limit = await consumeRateLimit(request, { scope: "consultation-availability", limit: 120, windowMs: 60_000 });
  if (!limit.allowed) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  await releaseExpiredConsultationHolds();
  const now = new Date();
  const from = validDate(request.nextUrl.searchParams.get("from"), now);
  const requestedTo = validDate(request.nextUrl.searchParams.get("to"), new Date(now.getTime() + 21 * 86_400_000));
  const effectiveFrom = new Date(Math.max(now.getTime(), from.getTime()));
  const to = new Date(Math.min(requestedTo.getTime(), effectiveFrom.getTime() + 60 * 86_400_000));
  if (to <= effectiveFrom) return NextResponse.json({ slots: [] });

  const slots = await prisma.consultationSlot.findMany({
    where: { status: "OPEN", startUtc: { gte: effectiveFrom, lte: to } },
    select: {
      id: true,
      hostUserId: true,
      startUtc: true,
      endUtc: true,
      timezone: true,
      host: { select: { name: true } },
    },
    orderBy: { startUtc: "asc" },
    take: 500,
  });
  const busyByHost = new Map<number, Array<{ start: Date; end: Date }> | null>();
  await Promise.all([...new Set(slots.map((slot) => slot.hostUserId))].map(async (hostUserId) => {
    try {
      busyByHost.set(hostUserId, await listHostBusyIntervals(hostUserId, effectiveFrom, to));
    } catch (error) {
      console.error("Google Calendar availability check failed closed", error);
      busyByHost.set(hostUserId, null);
    }
  }));
  const available = slots.filter((slot) => {
    const busy = busyByHost.get(slot.hostUserId);
    return busy !== null && !busy?.some((interval) => slot.startUtc < interval.end && slot.endUtc > interval.start);
  });
  return NextResponse.json({
    slots: available.map((slot) => ({
      id: slot.id,
      startUtc: slot.startUtc,
      endUtc: slot.endUtc,
      timezone: slot.timezone,
      hostName: slot.host.name || "Konzultant Spottex",
    })),
  });
}
