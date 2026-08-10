import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { httpsMediaUrl, httpsUrl } from "@/lib/content/validation";

const schema = z.object({ name: z.string().trim().min(2).max(120).optional(), title: z.string().trim().max(160).nullable().optional(), bio: z.string().trim().max(4000).nullable().optional(), photoUrl: httpsMediaUrl.nullable().optional(), linkedInUrl: httpsUrl.nullable().optional(), email: z.string().email().nullable().optional(), published: z.boolean().optional(), sortOrder: z.number().int().min(0).max(999).optional() });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await apiAdmin();
  if (!session) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const id = Number((await params).id);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!Number.isInteger(id) || !parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const founder = await prisma.founder.update({ where: { id }, data: parsed.data });
  await prisma.auditLog.create({ data: { actorUserId: Number(session.user.id), action: "FOUNDER_UPDATED", entityType: "Founder", entityId: String(id) } });
  return NextResponse.json({ founder });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await apiAdmin();
  if (!session) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const id = Number((await params).id);
  await prisma.founder.delete({ where: { id } });
  await prisma.auditLog.create({ data: { actorUserId: Number(session.user.id), action: "FOUNDER_DELETED", entityType: "Founder", entityId: String(id) } });
  return NextResponse.json({ ok: true });
}
