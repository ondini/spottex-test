import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { publicAppUrl } from "@/lib/auth/verification-url";
import { prisma } from "@/lib/prisma";

function redirectToLogin(request: Request, params: Record<string, string>) {
  const url = publicAppUrl("/prihlaseni", request.url);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url, request.method === "POST" ? 303 : 307);
}

function redirectToConfirmation(request: Request, token: string) {
  const url = publicAppUrl("/overit-email", request.url);
  url.searchParams.set("token", token);
  return NextResponse.redirect(url);
}

async function readVerification(token: string) {
  return prisma.emailVerification.findUnique({
    where: { tokenHash: createHash("sha256").update(token).digest("hex") },
    select: { id: true, userId: true, expiresAt: true, consumedAt: true },
  });
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token || token.length > 200) return redirectToLogin(request, { chyba: "neplatny-odkaz" });

  const verification = await readVerification(token);
  if (!verification) return redirectToLogin(request, { chyba: "neplatny-odkaz" });
  if (verification.consumedAt) return redirectToLogin(request, { overeno: "1" });
  if (verification.expiresAt <= new Date()) return redirectToLogin(request, { chyba: "odkaz-vyprsel" });
  return redirectToConfirmation(request, token);
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const token = form?.get("token");
  if (typeof token !== "string" || !token || token.length > 200) {
    return redirectToLogin(request, { chyba: "neplatny-odkaz" });
  }

  const verification = await readVerification(token);
  if (!verification) return redirectToLogin(request, { chyba: "neplatny-odkaz" });
  if (verification.consumedAt) return redirectToLogin(request, { overeno: "1" });
  if (verification.expiresAt <= new Date()) return redirectToLogin(request, { chyba: "odkaz-vyprsel" });

  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.emailVerification.updateMany({
        where: { id: verification.id, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      });
      const activated = await tx.user.updateMany({
        where: { id: verification.userId, status: "PENDING_VERIFICATION" },
        data: { status: "ACTIVE", emailVerifiedAt: new Date(), authVersion: { increment: 1 } },
      });
      if (!claimed.count || !activated.count) throw new Error("VERIFICATION_NOT_ALLOWED");
      await tx.auditLog.create({
        data: { actorUserId: verification.userId, action: "EMAIL_VERIFIED", entityType: "User", entityId: String(verification.userId) },
      });
    });
  } catch {
    return redirectToLogin(request, { chyba: "neplatny-odkaz" });
  }

  return redirectToLogin(request, { overeno: "1" });
}
