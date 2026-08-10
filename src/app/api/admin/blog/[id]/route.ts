import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { httpsMediaUrl } from "@/lib/content/validation";

const schema = z.object({ slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(), title: z.string().trim().min(3).max(220).optional(), excerpt: z.string().trim().max(800).nullable().optional(), content: z.string().trim().min(1).max(100000).optional(), coverUrl: httpsMediaUrl.nullable().optional(), seoTitle: z.string().trim().max(220).nullable().optional(), seoDescription: z.string().trim().max(500).nullable().optional(), published: z.boolean().optional() });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await apiAdmin();
  if (!session) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const id = Number((await params).id);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!Number.isInteger(id) || !parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const current = await prisma.blogPost.findUnique({ where: { id }, select: { published: true } });
  if (!current) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const post = await prisma.blogPost.update({
    where: { id },
    data: { ...parsed.data, ...(parsed.data.published === true && !current.published ? { publishedAt: new Date() } : {}), ...(parsed.data.published === false ? { publishedAt: null } : {}) },
  });
  await prisma.auditLog.create({ data: { actorUserId: Number(session.user.id), action: "BLOG_POST_UPDATED", entityType: "BlogPost", entityId: String(id) } });
  return NextResponse.json({ post });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await apiAdmin();
  if (!session) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const id = Number((await params).id);
  await prisma.blogPost.delete({ where: { id } });
  await prisma.auditLog.create({ data: { actorUserId: Number(session.user.id), action: "BLOG_POST_DELETED", entityType: "BlogPost", entityId: String(id) } });
  return NextResponse.json({ ok: true });
}
