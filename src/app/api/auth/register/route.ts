import { createHash, randomBytes } from "node:crypto";

import { Prisma, UserStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";

import { strongPasswordSchema } from "@/lib/auth/password";
import { emailVerificationUrl } from "@/lib/auth/verification-url";
import { protectEmailBody } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/security/rate-limit";

const registrationSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: strongPasswordSchema,
  consent: z.literal(true),
});

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(request: Request) {
  const parsed = registrationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Zkontrolujte jméno, e-mail a heslo. Heslo musí mít alespoň 10 znaků, velké písmeno a číslici." },
      { status: 400 },
    );
  }

  const [addressLimit, accountLimit] = await Promise.all([
    consumeRateLimit(request, { scope: "auth-register-address", limit: 5, windowMs: 60 * 60_000 }),
    consumeRateLimit(request, { scope: "auth-register-account", identity: parsed.data.email, includeAddress: false, limit: 3, windowMs: 24 * 60 * 60_000 }),
  ]);
  if (!addressLimit.allowed) return rateLimitedResponse(addressLimit);
  if (!accountLimit.allowed) return rateLimitedResponse(accountLimit);

  const autoVerify = process.env.DEV_AUTO_VERIFY_EMAIL === "true";
  const verificationToken = randomBytes(32).toString("base64url");
  const verificationTokenHash = tokenHash(verificationToken);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const verifyUrl = emailVerificationUrl(verificationToken);

  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: parsed.data.name,
          email: parsed.data.email,
          passwordHash,
          status: autoVerify ? UserStatus.ACTIVE : UserStatus.PENDING_VERIFICATION,
          emailVerifiedAt: autoVerify ? new Date() : null,
        },
        select: { id: true, email: true, name: true },
      });

      if (!autoVerify) {
        await tx.emailVerification.create({
          data: {
            userId: created.id,
            tokenHash: verificationTokenHash,
            expiresAt,
          },
        });
        const textBody = `Dobrý den,\n\nsvůj účet Spottex ověříte zde: ${verifyUrl}\n\nOdkaz platí 24 hodin.`;
        const htmlBody = `<p>Dobrý den,</p><p>děkujeme za registraci do Spottexu.</p><p><a href="${verifyUrl}">Ověřit e-mail a aktivovat účet</a></p><p>Odkaz platí 24 hodin.</p>`;
        await tx.emailOutbox.create({
          data: {
            idempotencyKey: `registration-verification:${created.id}:${verificationTokenHash}`,
            toEmail: created.email,
            subject: "Ověřte svůj účet Spottex",
            textBody: protectEmailBody(textBody),
            htmlBody: protectEmailBody(htmlBody),
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorUserId: created.id,
          action: "USER_REGISTERED",
          entityType: "User",
          entityId: String(created.id),
          metadata: { termsAccepted: true, autoVerified: autoVerify },
        },
      });
    });

    return NextResponse.json(
      {
        ok: true,
        autoVerified: autoVerify,
        message: autoVerify
          ? "Účet byl vytvořen."
          : "Účet byl vytvořen. Pro dokončení registrace zkontrolujte svůj e-mail.",
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({
        ok: true,
        autoVerified: false,
        message: "Pokud lze účet vytvořit, poslali jsme další pokyny na uvedený e-mail.",
      }, { status: 201 });
    }
    console.error("Registration failed", error);
    return NextResponse.json({ error: "Registraci se nepodařilo dokončit. Zkuste to prosím znovu." }, { status: 500 });
  }
}
