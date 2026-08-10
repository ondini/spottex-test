import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { signConsentCookie } from "@/lib/analytics/consent";
import { consumeRateLimit } from "@/lib/security/rate-limit";

const schema = z.object({ sessionId: z.string().uuid(), analytics: z.boolean(), marketing: z.boolean(), version: z.literal("2026-07") });

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });

  // Persist the browser's choice even when the append-only audit is currently
  // rate-limited or unavailable. Blocking the consent cookie would keep the
  // banner open and pressure the visitor to submit the same choice repeatedly.
  let audited = false;
  try {
    const [addressLimit, sessionLimit] = await Promise.all([
      consumeRateLimit(request, { scope: "analytics-consent-address", limit: 20, windowMs: 60 * 60_000 }),
      consumeRateLimit(request, { scope: "analytics-consent-session", identity: parsed.data.sessionId, includeAddress: false, limit: 10, windowMs: 60 * 60_000 }),
    ]);
    if (addressLimit.allowed && sessionLimit.allowed) {
      const session = await apiUser();
      await prisma.consentRecord.createMany({ data: [
        { sessionId: parsed.data.sessionId, userId: session ? Number(session.user.id) : null, category: "ANALYTICS", granted: parsed.data.analytics, version: parsed.data.version },
        { sessionId: parsed.data.sessionId, userId: session ? Number(session.user.id) : null, category: "MARKETING", granted: parsed.data.marketing, version: parsed.data.version },
      ] });
      audited = true;
    }
  } catch (error) {
    console.error("Consent audit could not be recorded", error);
  }

  const response = NextResponse.json({ ok: true, audited });
  response.cookies.set("spottex_consent", signConsentCookie({ a: parsed.data.analytics, m: parsed.data.marketing, v: parsed.data.version }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 365 * 24 * 60 * 60,
    path: "/",
  });
  return response;
}
