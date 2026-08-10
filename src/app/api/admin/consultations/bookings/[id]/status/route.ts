import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { apiAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

const schema = z.object({ status: z.enum(["COMPLETED", "NO_SHOW"]) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await apiAdmin();
  if (!session) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const id = Number((await params).id);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!Number.isInteger(id) || !parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const booking = await prisma.consultationBooking.findFirst({
    where: { id, status: "CONFIRMED", slot: { hostUserId: Number(session.user.id), endUtc: { lte: new Date() } } },
    select: { id: true },
  });
  if (!booking) return NextResponse.json({ error: "NOT_MODIFIABLE" }, { status: 409 });
  await prisma.consultationBooking.update({ where: { id }, data: { status: parsed.data.status, manageTokenExpiresAt: new Date() } });
  await prisma.auditLog.create({ data: { actorUserId: Number(session.user.id), action: "CONSULTATION_BOOKING_STATUS_CHANGED", entityType: "ConsultationBooking", entityId: String(id), metadata: { status: parsed.data.status } } });
  return NextResponse.json({ ok: true });
}
