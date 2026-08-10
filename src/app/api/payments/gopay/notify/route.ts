import { NextRequest, NextResponse } from "next/server";
import { reconcileGopay } from "@/lib/commerce/payment";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { prisma } from "@/lib/prisma";

async function handleNotification(request: NextRequest) {
  const localPaymentId = request.nextUrl.searchParams.get("payment");
  const providerPaymentId = request.nextUrl.searchParams.get("id");
  if (providerPaymentId && !/^\d{1,30}$/.test(providerPaymentId)) {
    return NextResponse.json({ error: "INVALID_PROVIDER_PAYMENT" }, { status: 400 });
  }
  let paymentId = localPaymentId;
  if (providerPaymentId) {
    const payment = await prisma.payment.findUnique({
      where: { provider_providerPaymentId: { provider: "GOPAY", providerPaymentId } },
      select: { id: true },
    });
    if (payment) {
      if (localPaymentId && localPaymentId !== payment.id) return NextResponse.json({ error: "PAYMENT_ID_MISMATCH" }, { status: 400 });
      paymentId = payment.id;
    } else if (localPaymentId) {
      const recoverable = await prisma.payment.findFirst({
        where: { id: localPaymentId, provider: "GOPAY", providerPaymentId: null, status: { in: ["CREATED", "PENDING"] } },
        select: { id: true },
      });
      if (!recoverable) return NextResponse.json({ error: "PAYMENT_ID_MISMATCH" }, { status: 400 });
      paymentId = recoverable.id;
    } else {
      return NextResponse.json({ error: "PAYMENT_ID_MISMATCH" }, { status: 400 });
    }
  }
  if (!paymentId) return NextResponse.json({ error: "MISSING_PAYMENT" }, { status: 400 });
  const addressLimit = await consumeRateLimit(request, { scope: "gopay-notification-address", limit: 30, windowMs: 60_000 });
  if (!addressLimit.allowed) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(addressLimit.retryAfterSeconds) } });
  const paymentLimit = await consumeRateLimit(request, { scope: "gopay-notification-payment", identity: paymentId, includeAddress: false, limit: 100, windowMs: 5 * 60_000 });
  if (!paymentLimit.allowed) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(paymentLimit.retryAfterSeconds) } });
  try {
    await reconcileGopay(paymentId, providerPaymentId || undefined);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "RECONCILIATION_FAILED" }, { status: 503 });
  }
}

// GoPay documents its asynchronous callback as HTTP GET with the provider
// payment ID in `?id=`. POST stays accepted for forward compatibility and
// manual gateway diagnostics; both paths perform a server-to-server status
// lookup before mutating local state.
export const GET = handleNotification;
export const POST = handleNotification;
