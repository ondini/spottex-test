import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { apiAdmin } from "@/lib/auth/guards";
import { getGoogleAccessToken, listBusyCalendarIntervals } from "@/lib/consultation/google-calendar";
import { generateWeekSlots, nextWeekReference, pragueDateParts, pragueWallClockToUtc } from "@/lib/consultation/time";
import { prisma } from "@/lib/prisma";

const schema = z.object({ weekStart: z.coerce.date().optional() });

function spread<T>(items: T[], count: number) {
  if (items.length <= count) return items;
  const selected: T[] = [];
  for (let index = 0; index < count; index += 1) selected.push(items[Math.floor(index * items.length / count)]);
  return selected;
}

export async function POST(request: NextRequest) {
  const session = await apiAdmin();
  if (!session) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const hostUserId = Number(session.user.id);
  const reference = parsed.data.weekStart || nextWeekReference();
  const local = pragueDateParts(reference);
  const localMonday = Date.UTC(local.year, local.month - 1, local.day) - (local.weekday - 1) * 86_400_000;
  const monday = new Date(localMonday);
  const weekStart = pragueWallClockToUtc(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), 0, 0);
  const nextMonday = new Date(localMonday + 7 * 86_400_000);
  const weekEnd = pragueWallClockToUtc(nextMonday.getUTCFullYear(), nextMonday.getUTCMonth() + 1, nextMonday.getUTCDate(), 0, 0);
  const candidates = generateWeekSlots(reference, { slotMinutes: 30 });
  const calendar = await prisma.consultationHostCalendar.upsert({
    where: { hostUserId },
    update: {},
    create: { hostUserId },
  });

  let busy: Array<{ start: Date; end: Date }> = [];
  try {
    if (calendar.maskCalendarIds.length) {
      const accessToken = await getGoogleAccessToken(hostUserId);
      if (accessToken) busy = await listBusyCalendarIntervals({ accessToken, calendarIds: calendar.maskCalendarIds, timeMin: weekStart, timeMax: weekEnd });
    }
  } catch (error) {
    console.error("Google busy mask failed; no slots were generated to avoid double booking", error);
    return NextResponse.json({ error: "CALENDAR_SYNC_FAILED" }, { status: 503 });
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(78104::int, ${hostUserId}::int)`;
    const existing = await tx.consultationSlot.findMany({
      where: { hostUserId, startUtc: { lt: weekEnd }, endUtc: { gt: weekStart }, status: { not: "CANCELED" } },
      select: { startUtc: true, endUtc: true },
    });
    const available = candidates.filter((candidate) =>
      candidate.startUtc > new Date()
      && !existing.some((slot) => candidate.startUtc < slot.endUtc && candidate.endUtc > slot.startUtc)
      && !busy.some((interval) => candidate.startUtc < interval.end && candidate.endUtc > interval.start),
    );
    const missing = Math.max(0, calendar.targetSlotsPerWeek - existing.length);
    const selected = spread(available, missing);
    const created = await tx.consultationSlot.createMany({
      data: selected.map((slot) => ({ hostUserId, startUtc: slot.startUtc, endUtc: slot.endUtc })),
      skipDuplicates: true,
    });
    await tx.auditLog.create({ data: { actorUserId: hostUserId, action: "CONSULTATION_SLOTS_GENERATED", entityType: "ConsultationSlot", metadata: { created: created.count, weekStart: weekStart.toISOString() } } });
    return { created: created.count, existing: existing.length, masked: candidates.length - available.length };
  });
  return NextResponse.json({ ...result, target: calendar.targetSlotsPerWeek });
}
