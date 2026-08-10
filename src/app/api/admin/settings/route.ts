import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

const schema = z.object({ metaPixelId: z.string().trim().max(40).nullable().optional(), metaPixelEnabled: z.boolean().optional(), analyticsEnabled: z.boolean().optional(), consultationLead: z.string().trim().max(1000).nullable().optional(), contactEmail: z.string().email().nullable().optional(), sellerCompanyName: z.string().trim().min(2).max(200).optional(), sellerCompanyId: z.string().trim().max(30).nullable().optional(), sellerVatId: z.string().trim().max(30).nullable().optional(), sellerAddress: z.string().trim().max(500).nullable().optional() });

export async function GET() {
  if (!(await apiAdmin())) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  return NextResponse.json({ settings: await prisma.siteSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }) });
}

export async function PATCH(request: NextRequest) {
  const session = await apiAdmin();
  if (!session) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const settings = await prisma.siteSettings.upsert({ where: { id: 1 }, update: parsed.data, create: { id: 1, ...parsed.data } });
  await prisma.auditLog.create({ data: { actorUserId: Number(session.user.id), action: "SITE_SETTINGS_UPDATED", entityType: "SiteSettings", entityId: "1" } });
  return NextResponse.json({ settings });
}
