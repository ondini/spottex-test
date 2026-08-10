import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { apiAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

const patchSchema = z.object({ status: z.enum(["OPEN", "BLOCKED"]) });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await apiAdmin();
  if (!session) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const id = Number((await params).id);
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!Number.isInteger(id) || !parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const changed = await prisma.consultationSlot.updateMany({
    where: { id, hostUserId: Number(session.user.id), status: { in: ["OPEN", "BLOCKED"] } },
    data: { status: parsed.data.status },
  });
  if (!changed.count) return NextResponse.json({ error: "NOT_MODIFIABLE" }, { status: 409 });
  await prisma.auditLog.create({ data: { actorUserId: Number(session.user.id), action: "CONSULTATION_SLOT_STATUS_CHANGED", entityType: "ConsultationSlot", entityId: String(id), metadata: { status: parsed.data.status } } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await apiAdmin();
  if (!session) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const slot = await prisma.consultationSlot.findFirst({
    where: { id, hostUserId: Number(session.user.id), status: { in: ["OPEN", "BLOCKED", "CANCELED"] } },
    select: { id: true, _count: { select: { bookings: true } } },
  });
  if (!slot) return NextResponse.json({ error: "NOT_MODIFIABLE" }, { status: 409 });
  if (slot._count.bookings) {
    await prisma.consultationSlot.update({ where: { id }, data: { status: "CANCELED" } });
  } else {
    await prisma.consultationSlot.delete({ where: { id } });
  }
  await prisma.auditLog.create({ data: { actorUserId: Number(session.user.id), action: "CONSULTATION_SLOT_REMOVED", entityType: "ConsultationSlot", entityId: String(id) } });
  return NextResponse.json({ ok: true });
}

