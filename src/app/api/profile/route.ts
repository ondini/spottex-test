import { NextResponse } from "next/server";
import { z } from "zod";

import { apiUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

const optionalText = (max: number) => z.string().trim().max(max).transform((value) => value || null);

const profileSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: optionalText(40),
  street: optionalText(160),
  city: optionalText(100),
  postalCode: optionalText(20),
  country: z.string().trim().length(2).transform((value) => value.toUpperCase()),
  companyName: optionalText(160),
  companyIdNumber: optionalText(30),
  vatId: optionalText(30),
});

const profileSelect = {
  id: true,
  email: true,
  name: true,
  phone: true,
  street: true,
  city: true,
  postalCode: true,
  country: true,
  companyName: true,
  companyIdNumber: true,
  vatId: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function GET() {
  const session = await apiUser();
  if (!session) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: Number(session.user.id) }, select: profileSelect });
  if (!user) return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ user });
}

async function updateProfile(request: Request) {
  const session = await apiUser();
  if (!session) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const parsed = profileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Zkontrolujte prosím vyplněné údaje." }, { status: 400 });
  }

  const userId = Number(session.user.id);
  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id: userId }, data: parsed.data, select: profileSelect });
    await tx.auditLog.create({
      data: { actorUserId: userId, action: "PROFILE_UPDATED", entityType: "User", entityId: String(userId) },
    });
    return updated;
  });
  return NextResponse.json({ user });
}

export const PATCH = updateProfile;
export const PUT = updateProfile;

