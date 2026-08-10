import { createHash, randomBytes } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { protectEmailBody } from "@/lib/email";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/security/rate-limit";

const inputSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
});

const genericResponse = { ok: true, message: "Pokud účet čeká na ověření, poslali jsme nový odkaz." };

export async function POST(request: Request) {
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json(genericResponse);
  const limit = await consumeRateLimit(request, { scope: "auth-verification-resend", identity: parsed.data.email, includeAddress: false, limit: 3, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitedResponse(limit);

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, email: true, status: true, emailVerifiedAt: true },
  });
  if (!user || user.status !== "PENDING_VERIFICATION" || user.emailVerifiedAt) return NextResponse.json(genericResponse);

  const recent = await prisma.emailVerification.findFirst({
    where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 60_000) } },
    select: { id: true },
  });
  if (recent) return NextResponse.json(genericResponse);

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const baseUrl = (process.env.APP_URL || process.env.AUTH_URL || "http://localhost:3004").replace(/\/$/, "");
  const verifyUrl = `${baseUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}`;

  await prisma.$transaction(async (tx) => {
    await tx.emailVerification.deleteMany({ where: { userId: user.id, consumedAt: null } });
    await tx.emailVerification.create({
      data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    });
    const textBody = `Dobrý den,\n\nsvůj účet Spottex ověříte zde: ${verifyUrl}\n\nOdkaz platí 24 hodin.`;
    const htmlBody = `<p>Dobrý den,</p><p><a href="${verifyUrl}">Ověřit e-mail a aktivovat účet Spottex</a></p><p>Odkaz platí 24 hodin.</p>`;
    await tx.emailOutbox.create({
      data: {
        idempotencyKey: `registration-verification:${user.id}:${tokenHash}`,
        toEmail: user.email,
        subject: "Nový ověřovací odkaz Spottex",
        textBody: protectEmailBody(textBody),
        htmlBody: protectEmailBody(htmlBody),
      },
    });
    await tx.auditLog.create({
      data: { actorUserId: user.id, action: "EMAIL_VERIFICATION_RESENT", entityType: "User", entityId: String(user.id) },
    });
  });

  return NextResponse.json(genericResponse);
}
