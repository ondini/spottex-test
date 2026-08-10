import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { httpsMediaUrl, httpsUrl } from "@/lib/content/validation";

const schema = z.object({ name: z.string().trim().min(2).max(160), slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), description: z.string().trim().max(5000).nullable().optional(), imageUrl: httpsMediaUrl.nullable().optional(), url: httpsUrl.nullable().optional(), location: z.string().trim().max(160).nullable().optional(), published: z.boolean().default(false), sortOrder: z.number().int().min(0).max(999).default(0) });

export async function GET() {
  if (!(await apiAdmin())) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  return NextResponse.json({ projects: await prisma.referenceProject.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }) });
}

export async function POST(request: NextRequest) {
  const session = await apiAdmin();
  if (!session) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  const project = await prisma.referenceProject.create({ data: parsed.data });
  await prisma.auditLog.create({ data: { actorUserId: Number(session.user.id), action: "PROJECT_CREATED", entityType: "ReferenceProject", entityId: String(project.id) } });
  return NextResponse.json({ project }, { status: 201 });
}
