import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { apiAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { hostCalendarHasConflict } from "@/lib/consultation/google-calendar";

const createSchema = z.object({
  startUtc: z.coerce.date(),
  endUtc: z.coerce.date(),
});

export async function GET(request: NextRequest) {
  const session = await apiAdmin();
  if (!session) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const now = new Date();
  const fromValue = request.nextUrl.searchParams.get("from");
  const toValue = request.nextUrl.searchParams.get("to");
  const from = fromValue && !Number.isNaN(new Date(fromValue).getTime()) ? new Date(fromValue) : new Date(now.getTime() - 2 * 86_400_000);
  const to = toValue && !Number.isNaN(new Date(toValue).getTime()) ? new Date(toValue) : new Date(now.getTime() + 45 * 86_400_000);
  const slots = await prisma.consultationSlot.findMany({
    where: { hostUserId: Number(session.user.id), startUtc: { gte: from, lte: to } },
    include: {
      bookings: {
        where: { status: { in: ["PENDING", "CONFIRMED", "COMPLETED", "NO_SHOW"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, guestName: true, guestEmail: true, guestPhone: true, note: true, status: true },
      },
    },
    orderBy: { startUtc: "asc" },
    take: 1_000,
  });
  return NextResponse.json({ slots: slots.map(({ bookings, ...slot }) => ({ ...slot, booking: bookings[0] || null })) });
}

export async function POST(request: NextRequest) {
  const session = await apiAdmin();
  if (!session) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const { startUtc, endUtc } = parsed.data;
  const duration = endUtc.getTime() - startUtc.getTime();
  if (startUtc <= new Date() || duration < 15 * 60_000 || duration > 2 * 60 * 60_000) {
    return NextResponse.json({ error: "INVALID_RANGE" }, { status: 400 });
  }
  const hostUserId = Number(session.user.id);
  try {
    if (await hostCalendarHasConflict(hostUserId, startUtc, endUtc)) return NextResponse.json({ error: "CALENDAR_OVERLAP" }, { status: 409 });
  } catch (error) {
    console.error("Google Calendar manual slot check failed closed", error);
    return NextResponse.json({ error: "CALENDAR_UNAVAILABLE" }, { status: 503 });
  }
  const slot = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(78104::int, ${hostUserId}::int)`;
    const overlap = await tx.consultationSlot.findFirst({
      where: {
        hostUserId,
        status: { not: "CANCELED" },
        startUtc: { lt: endUtc },
        endUtc: { gt: startUtc },
      },
      select: { id: true },
    });
    if (overlap) return null;
    const created = await tx.consultationSlot.create({ data: { hostUserId, startUtc, endUtc } });
    await tx.auditLog.create({ data: { actorUserId: hostUserId, action: "CONSULTATION_SLOT_CREATED", entityType: "ConsultationSlot", entityId: String(created.id) } });
    return created;
  });
  if (!slot) return NextResponse.json({ error: "OVERLAP" }, { status: 409 });
  return NextResponse.json({ slot }, { status: 201 });
}
