import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { httpsMediaUrl } from "@/lib/content/validation";

const schema = z.object({ slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), title: z.string().trim().min(3).max(220), excerpt: z.string().trim().max(800).nullable().optional(), content: z.string().trim().min(1).max(100000), coverUrl: httpsMediaUrl.nullable().optional(), seoTitle: z.string().trim().max(220).nullable().optional(), seoDescription: z.string().trim().max(500).nullable().optional(), published: z.boolean().default(false) });

export async function GET() {
  if (!(await apiAdmin())) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  return NextResponse.json({ posts: await prisma.blogPost.findMany({ include: { author: { select: { name: true, email: true } } }, orderBy: { updatedAt: "desc" } }) });
}

export async function POST(request: NextRequest) {
  const session = await apiAdmin();
  if (!session) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  const post = await prisma.blogPost.create({ data: { ...parsed.data, authorId: Number(session.user.id), publishedAt: parsed.data.published ? new Date() : null } });
  await prisma.auditLog.create({ data: { actorUserId: Number(session.user.id), action: "BLOG_POST_CREATED", entityType: "BlogPost", entityId: String(post.id) } });
  return NextResponse.json({ post }, { status: 201 });
}
