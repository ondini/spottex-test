import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { strongPasswordSchema } from "@/lib/auth/password";
import { hashToken } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

const schema = z.object({ token: z.string().min(20).max(200), password: strongPasswordSchema });

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const reset = await prisma.passwordReset.findUnique({ where: { tokenHash: hashToken(parsed.data.token) }, select: { id: true, userId: true } });
  if (!reset) return NextResponse.json({ error: "INVALID_OR_EXPIRED" }, { status: 400 });
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordReset.updateMany({
        where: { id: reset.id, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      });
      if (!claimed.count) throw new Error("INVALID_OR_EXPIRED");
      await tx.user.update({ where: { id: reset.userId }, data: { passwordHash, authVersion: { increment: 1 } } });
      await tx.passwordReset.updateMany({ where: { userId: reset.userId, consumedAt: null }, data: { consumedAt: new Date() } });
      await tx.auditLog.create({ data: { actorUserId: reset.userId, action: "PASSWORD_RESET_COMPLETED", entityType: "User", entityId: String(reset.userId) } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_OR_EXPIRED") return NextResponse.json({ error: "INVALID_OR_EXPIRED" }, { status: 400 });
    console.error("Password reset failed", error);
    return NextResponse.json({ error: "RESET_FAILED" }, { status: 500 });
  }
}
