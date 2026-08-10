import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { verifyConsentCookie } from "@/lib/analytics/consent";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/security/rate-limit";

const allowedTypes = ["PAGE_VIEW", "SIGNUP_STARTED", "SIGNUP_COMPLETED", "LOGIN", "CONSULTATION_VIEW", "CONSULTATION_BOOKED", "CART_UPDATED", "CHECKOUT_STARTED", "TRIAL_ACTIVATED", "PAYMENT_COMPLETED", "DASHBOARD_VIEW", "INVERTER_COMMAND"] as const;
const schema = z.object({ type: z.enum(allowedTypes), path: z.string().max(500).optional(), sessionId: z.string().uuid(), properties: z.record(z.string(), z.union([z.string().max(300), z.number(), z.boolean(), z.null()])).default({}) });
const forbidden = /email|name|phone|address|token|password|ean/i;

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.success ? parsed.data.properties : {}).some((key) => forbidden.test(key))) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const consent = verifyConsentCookie(request.cookies.get("spottex_consent")?.value);
  if (consent?.a !== true) return NextResponse.json({ error: "ANALYTICS_CONSENT_REQUIRED" }, { status: 403 });
  const [addressLimit, sessionLimit] = await Promise.all([
    consumeRateLimit(request, { scope: "analytics-event-address", limit: 180, windowMs: 60_000 }),
    consumeRateLimit(request, { scope: "analytics-event-session", identity: parsed.data.sessionId, includeAddress: false, limit: 90, windowMs: 60_000 }),
  ]);
  if (!addressLimit.allowed) return rateLimitedResponse(addressLimit);
  if (!sessionLimit.allowed) return rateLimitedResponse(sessionLimit);
  const settings = await prisma.siteSettings.findUnique({ where: { id: 1 }, select: { analyticsEnabled: true } });
  if (settings?.analyticsEnabled === false) return NextResponse.json({ ok: true, disabled: true });
  const session = await apiUser();
  let properties = parsed.data.properties;
  let deduplicationKey: string | null = null;
  if (["TRIAL_ACTIVATED", "PAYMENT_COMPLETED"].includes(parsed.data.type)) {
    if (!session || typeof properties.paymentId !== "string") return NextResponse.json({ error: "INVALID_PAYMENT_EVENT" }, { status: 400 });
    const payment = await prisma.payment.findFirst({
      where: { id: properties.paymentId, userId: Number(session.user.id), status: "PAID" },
      select: { id: true, amountMinor: true, currency: true },
    });
    const expectedTrial = parsed.data.type === "TRIAL_ACTIVATED";
    if (!payment || (payment.amountMinor === 0) !== expectedTrial) return NextResponse.json({ error: "INVALID_PAYMENT_EVENT" }, { status: 400 });
    deduplicationKey = `payment:${payment.id}:${parsed.data.type}`;
    properties = { paymentId: payment.id, value: payment.amountMinor / 100, currency: payment.currency };
  }
  const created = await prisma.analyticsEvent.createMany({
    data: [{ ...parsed.data, properties, deduplicationKey, userId: session ? Number(session.user.id) : null }],
    skipDuplicates: true,
  });
  if (!created.count) return NextResponse.json({ ok: true, duplicate: true });
  return NextResponse.json({ ok: true }, { status: 201 });
}
