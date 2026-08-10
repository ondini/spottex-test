import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { httpsMediaUrl, httpsUrl } from "@/lib/content/validation";

const schema = z.object({ name: z.string().trim().min(2).max(120), title: z.string().trim().max(160).nullable().optional(), bio: z.string().trim().max(4000).nullable().optional(), photoUrl: httpsMediaUrl.nullable().optional(), linkedInUrl: httpsUrl.nullable().optional(), email: z.string().email().nullable().optional(), published: z.boolean().default(false), sortOrder: z.number().int().min(0).max(999).default(0) });

export async function GET() {
  if (!(await apiAdmin())) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  return NextResponse.json({ founders: await prisma.founder.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }) });
}

export async function POST(request: NextRequest) {
  const session = await apiAdmin();
  if (!session) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  const founder = await prisma.founder.create({ data: parsed.data });
  await prisma.auditLog.create({ data: { actorUserId: Number(session.user.id), action: "FOUNDER_CREATED", entityType: "Founder", entityId: String(founder.id) } });
  return NextResponse.json({ founder }, { status: 201 });
}
