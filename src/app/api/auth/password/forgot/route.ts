import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { generateToken, hashToken } from "@/lib/crypto";
import { queueEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/security/rate-limit";

const schema = z.object({ email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()) });
const generic = { ok: true, message: "Pokud účet existuje, poslali jsme odkaz pro obnovu hesla." };

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json(generic);
  const [addressLimit, accountLimit] = await Promise.all([
    consumeRateLimit(request, { scope: "password-reset-address", limit: 8, windowMs: 15 * 60_000 }),
    consumeRateLimit(request, { scope: "password-reset-account", identity: parsed.data.email, includeAddress: false, limit: 3, windowMs: 60 * 60_000 }),
  ]);
  if (!addressLimit.allowed || !accountLimit.allowed) return NextResponse.json(generic);

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email }, select: { id: true, email: true, name: true, status: true } });
  if (!user || user.status !== "ACTIVE") return NextResponse.json(generic);
  const recent = await prisma.passwordReset.findFirst({ where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 60_000) } } });
  if (recent) return NextResponse.json(generic);

  const token = generateToken();
  const reset = await prisma.$transaction(async (tx) => {
    await tx.passwordReset.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: new Date() } });
    const created = await tx.passwordReset.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60 * 60_000) } });
    await tx.auditLog.create({ data: { actorUserId: user.id, action: "PASSWORD_RESET_EMAIL_QUEUED", entityType: "User", entityId: String(user.id) } });
    return created;
  });
  const resetUrl = `${(process.env.APP_URL || process.env.AUTH_URL || "http://localhost:3004").replace(/\/$/, "")}/obnova-hesla?token=${encodeURIComponent(token)}`;
  const safeName = user.name?.replace(/[<>&"']/g, "") || "";
  await queueEmail({
    idempotencyKey: `password-reset:${reset.id}`,
    to: user.email,
    subject: "Obnova hesla Spottex",
    text: `Dobrý den${user.name ? ` ${user.name}` : ""},\n\nnové heslo nastavíte zde: ${resetUrl}\n\nOdkaz platí 60 minut. Pokud jste o změnu nežádali, e-mail ignorujte.`,
    html: `<p>Dobrý den${safeName ? ` ${safeName}` : ""},</p><p><a href="${resetUrl}">Nastavit nové heslo Spottex</a></p><p>Odkaz platí 60 minut. Pokud jste o změnu nežádali, e-mail ignorujte.</p>`,
  });
  return NextResponse.json(generic);
}
