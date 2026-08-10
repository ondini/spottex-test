import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

import {
  enqueueInverterDeactivationJob,
  processInverterDeactivationJobs,
} from "@/lib/energy/deactivation-jobs";
import { productFreeTrialDays } from "@/lib/commerce/cart";
import { freeAccessEnabled } from "@/lib/commerce/free-access";
import { protectEmailBody } from "@/lib/email";
import { prisma } from "@/lib/prisma";

type CheckoutResult = { paymentId: string; redirectUrl: string };

export const RECURRING_CONSENT_VERSION = "2026-07-21";
export const RECURRING_MAX_AMOUNT_MINOR = 99_000;
export const RECURRING_NOTICE_DAYS = 14;
const RECURRING_CONSENT_TEXT = "Souhlasím s uložením GoPay mandátu pro opakovanou roční platbu služby Spottex. Cena dalšího roku bude oznámena nejméně 14 dní předem a nepřesáhne 990 Kč. Budoucí platby mohu kdykoli zrušit v účtu.";

export function recurringPaymentParameters(now = new Date()) {
  const validUntil = new Date(Date.UTC(now.getUTCFullYear() + 3, now.getUTCMonth(), now.getUTCDate()));
  return {
    recurrence: {
      recurrence_cycle: "ON_DEMAND" as const,
      recurrence_date_to: validUntil.toISOString().slice(0, 10),
    },
    consent: {
      accepted: true as const,
      version: RECURRING_CONSENT_VERSION,
      textSha256: createHash("sha256").update(RECURRING_CONSENT_TEXT).digest("hex"),
      consentedAt: now.toISOString(),
      validUntil: validUntil.toISOString(),
      maxAmountMinor: RECURRING_MAX_AMOUNT_MINOR,
      renewalPeriodDays: 365,
      noticeDays: RECURRING_NOTICE_DAYS,
    },
  };
}

function jsonObject(value: Prisma.JsonValue | null | undefined): Prisma.JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Prisma.JsonObject : {};
}

async function markGopayCreateUncertain(paymentId: string, previousPayload: Prisma.JsonValue | null | undefined) {
  await prisma.payment.updateMany({
    where: { id: paymentId, status: "PENDING", providerPaymentId: null },
    data: { providerPayload: { ...jsonObject(previousPayload), state: "CREATE_UNCERTAIN" } as Prisma.InputJsonValue },
  });
}

export function safeGopayGatewayUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const apiHost = new URL(process.env.GOPAY_API_URL || "https://gw.sandbox.gopay.com/api").hostname;
    const trustedHost = url.hostname === apiHost || url.hostname.endsWith(".gopay.com") || url.hostname.endsWith(".gopay.cz");
    return url.protocol === "https:" && trustedHost ? url.toString() : null;
  } catch {
    return null;
  }
}

async function reopenCartIfPossible(cartId: string, userId: number) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(56321::int, ${userId}::int)`;
    const anotherOpen = await tx.cart.findFirst({ where: { userId, status: "OPEN", id: { not: cartId } }, select: { id: true } });
    return tx.cart.update({ where: { id: cartId }, data: { status: anotherOpen ? "CANCELED" : "OPEN" } });
  });
}

export async function gopayAccessToken() {
  const clientId = process.env.GOPAY_CLIENT_ID;
  const clientSecret = process.env.GOPAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GoPay credentials are not configured");
  const response = await fetch(`${process.env.GOPAY_API_URL || "https://gw.sandbox.gopay.com/api"}/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "payment-all" }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await response.json().catch(() => null)) as { access_token?: string; error?: string } | null;
  if (!response.ok || !data?.access_token) throw new Error(`GoPay authentication failed: ${data?.error || response.status}`);
  return data.access_token;
}

export async function createCheckout(
  userId: number,
  cartId: string,
  options: { recurringConsent?: boolean } = {},
): Promise<CheckoutResult> {
  const prepared = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${cartId}))`;
    const cart = await tx.cart.findFirst({
      where: { id: cartId, userId, status: { in: ["OPEN", "CHECKOUT"] } },
      include: { items: { include: { product: true } }, user: true },
    });
    if (!cart || !cart.items.length) throw new Error("CART_NOT_CHECKOUTABLE");
    const existing = await tx.payment.findFirst({
      where: { cartId, status: { in: ["CREATED", "PENDING"] } },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return { cart, payment: existing, existing: true as const };
    if (cart.status !== "OPEN") throw new Error("CART_CHECKOUT_IN_PROGRESS");
    const listedTotalMinor = cart.items.reduce((sum, item) => sum + item.unitPriceMinor * item.quantity, 0);
    if (!Number.isSafeInteger(listedTotalMinor) || listedTotalMinor < 0) throw new Error("CART_NOT_CHECKOUTABLE");
    const freeAccess = freeAccessEnabled();
    const totalMinor = freeAccess ? 0 : listedTotalMinor;
    if (totalMinor === 0 && !freeAccess) {
      const trialAlreadyUsed = await tx.subscription.findFirst({
        where: { userId, productId: { in: cart.items.map((item) => item.productId) } },
        select: { id: true },
      });
      if (trialAlreadyUsed) throw new Error("TRIAL_ALREADY_USED");
    }
    const configured = (process.env.PAYMENT_PROVIDER || "MOCK").toUpperCase();
    const provider = totalMinor === 0 ? "MANUAL" : configured === "GOPAY" ? "GOPAY" : "MOCK";
    const claimed = await tx.cart.updateMany({ where: { id: cart.id, status: "OPEN" }, data: { status: "CHECKOUT", totalMinor } });
    if (!claimed.count) throw new Error("CART_CHECKOUT_IN_PROGRESS");
    const recurring = ["GOPAY", "MOCK"].includes(provider)
      && options.recurringConsent === true
      && cart.items.some((item) => item.product.type === "SUBSCRIPTION");
    const recurringParameters = recurring ? recurringPaymentParameters() : null;
    const analysisRunIds = [...new Set(cart.items.flatMap((item) => {
      const value = jsonObject(item.metadata).analysisRunId;
      return typeof value === "string" && value ? [value] : [];
    }))];
    if (analysisRunIds.length > 1) throw new Error("CART_MULTIPLE_ANALYSIS_RUNS");
    const serviceOfferIds = [...new Set(cart.items.flatMap((item) => {
      const value = jsonObject(item.metadata).serviceOfferId;
      return typeof value === "string" && value ? [value] : [];
    }))];
    if (serviceOfferIds.length > 1) throw new Error("CART_MULTIPLE_SERVICE_OFFERS");
    if (totalMinor > 0 && cart.items.some((item) => item.product.type === "SUBSCRIPTION") && serviceOfferIds.length !== 1) {
      throw new Error("SERVICE_OFFER_REQUIRED");
    }
    const payment = await tx.payment.create({
      data: {
        userId,
        cartId,
        provider,
        status: "PENDING",
        amountMinor: totalMinor,
        currency: cart.currency,
        idempotencyKey: `checkout-${cart.id}-${randomUUID()}`,
        chargeKind: recurring ? "MANDATE_FIRST" : "ONE_OFF",
        analysisRunId: analysisRunIds[0] ?? null,
        serviceOfferId: serviceOfferIds[0] ?? null,
        providerPayload: {
          freeAccess,
          listedTotalMinor,
          checkout: { items: cart.items.map((item) => ({ productId: item.productId, name: item.productName, quantity: item.quantity, unitPriceMinor: item.unitPriceMinor })) },
          ...(recurringParameters ? { recurringConsent: recurringParameters.consent } : {}),
        },
      },
    });
    return { cart: { ...cart, totalMinor }, payment, existing: false as const };
  });

  const { cart, payment } = prepared;
  const existing = prepared.existing ? payment : null;
  if (existing) {
    if (existing.provider === "MOCK") return { paymentId: existing.id, redirectUrl: mockRedirect(existing.id) };
    if (existing.provider === "MANUAL") return { paymentId: existing.id, redirectUrl: paymentReturnRedirect(existing.id) };
    const payload = existing.providerPayload as { gatewayUrl?: unknown };
    const gatewayUrl = safeGopayGatewayUrl(payload.gatewayUrl);
    if (gatewayUrl) return { paymentId: existing.id, redirectUrl: gatewayUrl };
    // A process can die after GoPay accepted the request but before its id was
    // persisted. Keep the immutable checkout claimed and let the provider
    // notification link it by the local order number. A job releases truly
    // orphaned intents after the recovery window.
    return { paymentId: existing.id, redirectUrl: paymentReturnRedirect(existing.id) };
  }
  const provider = payment.provider;

  if (provider === "MANUAL") {
    const paymentFreeAccess =
      jsonObject(payment.providerPayload).freeAccess === true;
    try {
      await finalizePaidPayment(payment.id, {
        freeAccess: paymentFreeAccess,
        freeTrial: !paymentFreeAccess,
      });
    } catch (error) {
      await prisma.$transaction([
        prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED", providerPayload: { error: error instanceof Error ? error.message : "TRIAL_FAILED" } } }),
        prisma.cart.updateMany({ where: { id: cart.id, status: "CHECKOUT" }, data: { status: "CANCELED" } }),
      ]);
      throw error;
    }
    return { paymentId: payment.id, redirectUrl: paymentReturnRedirect(payment.id) };
  }
  if (provider === "MOCK") return { paymentId: payment.id, redirectUrl: mockRedirect(payment.id) };

  try {
    const goId = Number(process.env.GOPAY_GO_ID);
    if (!Number.isSafeInteger(goId) || goId <= 0) throw new Error("GOPAY_GO_ID is not configured");
    const token = await gopayAccessToken();
    const base = process.env.APP_URL || "http://localhost:3004";
    const recurringParameters = payment.chargeKind === "MANDATE_FIRST" ? recurringPaymentParameters(payment.createdAt) : null;
    let response: Response;
    try {
      response = await fetch(`${process.env.GOPAY_API_URL || "https://gw.sandbox.gopay.com/api"}/payments/payment`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          target: { type: "ACCOUNT", goid: goId },
          payer: { allowed_payment_instruments: recurringParameters ? ["PAYMENT_CARD"] : ["PAYMENT_CARD", "BANK_ACCOUNT"], contact: { email: cart.user.email } },
          amount: payment.amountMinor,
          currency: payment.currency,
          order_number: payment.id,
          order_description: "Spottex – chytré řízení střídače",
          items: cart.items.map((item) => ({ name: item.productName, amount: item.unitPriceMinor, count: item.quantity, type: "ITEM" })),
          callback: {
            return_url: `${base}/platba/navrat?payment=${payment.id}`,
            notification_url: `${base}/api/payments/gopay/notify?payment=${payment.id}`,
          },
          lang: "CS",
          ...(recurringParameters ? { recurrence: recurringParameters.recurrence } : {}),
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      await markGopayCreateUncertain(payment.id, payment.providerPayload);
      return { paymentId: payment.id, redirectUrl: paymentReturnRedirect(payment.id) };
    }
    const data = (await response.json().catch(() => null)) as { id?: number; gw_url?: string } | null;
    if (!response.ok) {
      // A timeout, conflict/rate-limit or provider 5xx may be returned after
      // the provider accepted the order. Keep the cart immutable so a later
      // signed notification can link and settle the local payment safely.
      if (response.status >= 500 || [408, 409, 425, 429].includes(response.status)) {
        await markGopayCreateUncertain(payment.id, payment.providerPayload);
        return { paymentId: payment.id, redirectUrl: paymentReturnRedirect(payment.id) };
      }
      throw new Error(`GoPay create failed: ${response.status}`);
    }
    const gatewayUrl = safeGopayGatewayUrl(data?.gw_url);
    if (!data?.id || !gatewayUrl) {
      await markGopayCreateUncertain(payment.id, payment.providerPayload);
      return { paymentId: payment.id, redirectUrl: paymentReturnRedirect(payment.id) };
    }
    const previousPayload = jsonObject(payment.providerPayload);
    try {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { providerPaymentId: String(data.id), providerPayload: { ...previousPayload, state: "CREATED", gatewayUrl } as Prisma.InputJsonValue },
      });
    } catch {
      // GoPay may already own the payment. Do not reopen mutable cart data;
      // its signed server-to-server notification can recover the link.
      return { paymentId: payment.id, redirectUrl: paymentReturnRedirect(payment.id) };
    }
    return { paymentId: payment.id, redirectUrl: gatewayUrl };
  } catch (error) {
    const previousPayload = jsonObject(payment.providerPayload);
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "FAILED",
        providerPayload: {
          ...previousPayload,
          state: "CREATE_FAILED",
          error: error instanceof Error ? error.message : "unknown",
        } as Prisma.InputJsonValue,
      },
    });
    await reopenCartIfPossible(cart.id, userId);
    throw error;
  }
}

function mockRedirect(paymentId: string) {
  return `${process.env.APP_URL || "http://localhost:3004"}/platba/mock?payment=${encodeURIComponent(paymentId)}`;
}

function paymentReturnRedirect(paymentId: string) {
  return `${process.env.APP_URL || "http://localhost:3004"}/platba/navrat?payment=${encodeURIComponent(paymentId)}`;
}

export function invoiceYearFor(issuedAt: Date) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Prague", year: "numeric" }).format(issuedAt));
}

async function nextInvoiceNumber(tx: Prisma.TransactionClient, issuedAt: Date) {
  const year = invoiceYearFor(issuedAt);
  const counter = await tx.invoiceCounter.upsert({
    where: { year },
    create: { year, sequence: 1 },
    update: { sequence: { increment: 1 } },
  });
  return `${year}${String(counter.sequence).padStart(6, "0")}`;
}

export async function finalizePaidPayment(paymentId: string, providerPayload: Prisma.InputJsonValue = {}) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${paymentId}))`;
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: {
        cart: { include: { items: { include: { product: true } } } },
        user: true,
        invoices: true,
        serviceOffer: { select: { energySiteId: true } },
        recurringRenewal: { include: { subscription: { select: { energySiteId: true } } } },
        analysisRun: true,
      },
    });
    if (!payment) throw new Error("PAYMENT_NOT_FOUND");
    if (payment.status === "PAID") {
      const invoice = payment.invoices[0] ?? null;
      const recurring = Boolean(payment.recurringMandateId) || payment.chargeKind === "MANDATE_FIRST" || payment.chargeKind === "MANDATE_REPEAT";
      const accountUrl = `${process.env.APP_URL || "http://localhost:3004"}/app/sluzba`;
      const invoiceUrl = invoice ? `${process.env.APP_URL || "http://localhost:3004"}/app/faktury/${invoice.id}` : null;
      const freeAccessPayment =
        jsonObject(payment.providerPayload).freeAccess === true;
      const text = payment.amountMinor > 0
        ? `Dobrý den${payment.user.name ? ` ${payment.user.name}` : ""},\n\nplatbu ${new Intl.NumberFormat("cs-CZ", { style: "currency", currency: payment.currency }).format(payment.amountMinor / 100)} jsme přijali.${invoice ? ` Daňový doklad ${invoice.number} najdete zde: ${invoiceUrl}` : ""}\n\n${recurring ? "Roční obnovení je povolené. Novou cenu vám oznámíme nejméně 14 dní předem; bez nové analýzy a předchozího oznámení nic nestrhneme. Obnovu můžete kdykoli vypnout." : "Automatické roční obnovení pro tuto platbu není aktivní."}\n\nSpráva služby: ${accountUrl}`
        : `Dobrý den${payment.user.name ? ` ${payment.user.name}` : ""},\n\n${freeAccessPayment ? "bezplatný přístup ke službě Spottex byl aktivován" : "bezplatné období služby Spottex bylo aktivováno"}. Stav služby najdete zde: ${accountUrl}`;
      await tx.emailOutbox.upsert({
        where: { idempotencyKey: `payment:${payment.id}:confirmation` },
        update: {},
        create: {
          idempotencyKey: `payment:${payment.id}:confirmation`,
          toEmail: payment.user.email,
          subject: payment.amountMinor > 0 ? "Potvrzení platby Spottex a daňový doklad" : "Služba Spottex byla aktivována",
          textBody: protectEmailBody(text),
        },
      });
      return payment;
    }
    if (!payment.cart) throw new Error("PAYMENT_WITHOUT_CART");
    const freeAccessPayment =
      jsonObject(payment.providerPayload).freeAccess === true;
    const immutableTotal = payment.cart.items.reduce((sum, item) => sum + item.unitPriceMinor * item.quantity, 0);
    const expectedChargedTotal = freeAccessPayment ? 0 : immutableTotal;
    if (payment.cart.status !== "CHECKOUT" || expectedChargedTotal !== payment.amountMinor || payment.cart.totalMinor !== payment.amountMinor) {
      throw new Error("PAYMENT_CART_MISMATCH");
    }
    const fulfilledAt = new Date();
    if (payment.analysisRunId) {
      if (!payment.analysisRun || payment.analysisRun.userId !== payment.userId || payment.analysisRun.kind !== "PRO" || payment.analysisRun.status !== "DRAFT" || (!freeAccessPayment && payment.analysisRun.proPriceMinor !== payment.amountMinor)) {
        throw new Error("PAYMENT_ANALYSIS_MISMATCH");
      }
    }
    if (payment.serviceOfferId) {
      const accepted = await tx.serviceOffer.updateMany({ where: { id: payment.serviceOfferId, userId: payment.userId, status: "OFFERED", validUntil: { gt: fulfilledAt }, ...(freeAccessPayment ? {} : { finalPriceMinor: payment.amountMinor }) }, data: { status: "ACCEPTED", acceptedAt: fulfilledAt } });
      if (!accepted.count) throw new Error("PAYMENT_SERVICE_OFFER_MISMATCH");
    }

    for (const item of payment.cart.items) {
      if (item.product.type !== "SUBSCRIPTION") continue;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${payment.userId}::int, ${item.productId}::int)`;
      if (payment.amountMinor === 0 && !freeAccessPayment) {
        const previousTrialOrService = await tx.subscription.findFirst({
          where: { userId: payment.userId, productId: item.productId },
          select: { id: true },
        });
        if (previousTrialOrService) throw new Error("TRIAL_ALREADY_USED");
      }
    }

    const previousProviderPayload = jsonObject(payment.providerPayload);
    const nextProviderPayload = jsonObject(providerPayload as Prisma.JsonValue);
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "PAID", paidAt: fulfilledAt, providerPayload: { ...previousProviderPayload, ...nextProviderPayload } as Prisma.InputJsonValue },
    });
    await tx.cart.update({ where: { id: payment.cart.id }, data: { status: "PAID" } });

    if (payment.analysisRunId) {
      const queued = await tx.energyAnalysisRun.updateMany({ where: { id: payment.analysisRunId, userId: payment.userId, status: "DRAFT" }, data: { status: "QUEUED" } });
      if (!queued.count) throw new Error("PAYMENT_ANALYSIS_MISMATCH");
      await tx.scheduledJob.create({ data: { type: "ENERGY_ANALYSIS_V2", idempotencyKey: `energy-analysis:${payment.analysisRunId}`, payload: { version: 2, analysisRunId: payment.analysisRunId }, runAt: fulfilledAt } });
      await tx.auditLog.create({ data: { actorUserId: payment.userId, action: "PRO_ANALYSIS_PAID_AND_QUEUED", entityType: "EnergyAnalysisRun", entityId: payment.analysisRunId, metadata: { paymentId: payment.id, amountMinor: payment.amountMinor } } });
    }

    let recurringMandateId = payment.recurringMandateId;
    if (["GOPAY", "MOCK"].includes(payment.provider) && payment.chargeKind === "MANDATE_FIRST") {
      const providerParentPaymentId = payment.providerPaymentId ?? (payment.provider === "MOCK" ? payment.id : null);
      if (!providerParentPaymentId) throw new Error("GOPAY_MANDATE_WITHOUT_PARENT_PAYMENT");
      const consent = jsonObject(previousProviderPayload.recurringConsent as Prisma.JsonValue | undefined);
      if (consent.accepted !== true || typeof consent.version !== "string" || typeof consent.textSha256 !== "string") {
        throw new Error("GOPAY_MANDATE_WITHOUT_CONSENT");
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${payment.userId}::int, 90817::int)`;
      const existingMandate = await tx.recurringPaymentMandate.findFirst({
        where: { userId: payment.userId, provider: payment.provider, status: { in: ["PENDING", "ACTIVE"] } },
      });
      const mandate = existingMandate ?? await tx.recurringPaymentMandate.create({
        data: {
          userId: payment.userId,
          provider: payment.provider,
          providerParentPaymentId,
          status: "ACTIVE",
          currency: payment.currency,
          maxAmountMinor: Number(consent.maxAmountMinor) || RECURRING_MAX_AMOUNT_MINOR,
          renewalPeriodDays: Number(consent.renewalPeriodDays) || 365,
          noticeDays: Number(consent.noticeDays) || RECURRING_NOTICE_DAYS,
          consentVersion: consent.version,
          consentTextSha256: consent.textSha256,
          consentedAt: new Date(String(consent.consentedAt || payment.createdAt.toISOString())),
          validUntil: consent.validUntil ? new Date(String(consent.validUntil)) : null,
          lastUsedAt: fulfilledAt,
          metadata: { firstPaymentId: payment.id },
        },
      });
      if (mandate.providerParentPaymentId !== providerParentPaymentId) {
        throw new Error("GOPAY_ACTIVE_MANDATE_ALREADY_EXISTS");
      }
      recurringMandateId = mandate.id;
      await tx.payment.update({ where: { id: payment.id }, data: { recurringMandateId: mandate.id } });
    }

    for (const item of payment.cart.items) {
      if (item.product.type !== "SUBSCRIPTION") continue;
      const startsAt = fulfilledAt;
      const active = await tx.subscription.findFirst({
        where: { userId: payment.userId, productId: item.productId, status: { in: ["ACTIVE", "TRIAL"] }, OR: [{ endsAt: null }, { endsAt: { gt: startsAt } }] },
        orderBy: { endsAt: "desc" },
      });
      const baseStart = active?.endsAt && active.endsAt > startsAt ? active.endsAt : startsAt;
      const trialDays = productFreeTrialDays(item.product.metadata) || 30;
      const days = payment.amountMinor === 0 ? trialDays : item.product.billingPeriodDays || 30;
      await tx.subscription.create({
        data: {
          userId: payment.userId,
          productId: item.productId,
          paymentId: payment.id,
          status: freeAccessPayment || payment.amountMinor > 0 ? "ACTIVE" : "TRIAL",
          source: payment.amountMinor === 0 ? "MANUAL" : "PAID",
          startsAt: baseStart,
          endsAt: freeAccessPayment
            ? null
            : new Date(baseStart.getTime() + days * item.quantity * 86_400_000),
          recurringMandateId,
          energySiteId: payment.recurringRenewal?.subscription.energySiteId
            ?? payment.serviceOffer?.energySiteId
            ?? null,
        },
      });
    }

    if (payment.recurringRenewalId) {
      await tx.recurringRenewal.updateMany({
        where: { id: payment.recurringRenewalId, status: { in: ["CHARGE_PENDING", "RETRY", "NOTICE_SENT"] } },
        data: { status: "PAID", completedAt: fulfilledAt, nextAttemptAt: null, lastError: null },
      });
      if (recurringMandateId) {
        await tx.recurringPaymentMandate.updateMany({
          where: { id: recurringMandateId, status: "ACTIVE" },
          data: { lastUsedAt: fulfilledAt },
        });
      }
    }

    let invoice = payment.invoices[0] ?? null;
    if (payment.amountMinor > 0 && !invoice) {
      const settings = await tx.siteSettings.findUnique({ where: { id: 1 } });
      const number = await nextInvoiceNumber(tx, fulfilledAt);
      invoice = await tx.invoice.create({
        data: {
          number,
          userId: payment.userId,
          paymentId: payment.id,
          status: "PAID",
          subtotalMinor: payment.amountMinor,
          totalMinor: payment.amountMinor,
          issuedAt: fulfilledAt,
          paidAt: fulfilledAt,
          sellerSnapshot: {
            name: settings?.sellerCompanyName || "Spottex Energy s.r.o.",
            companyId: settings?.sellerCompanyId,
            vatId: settings?.sellerVatId,
            address: settings?.sellerAddress,
          },
          customerSnapshot: {
            name: payment.user.companyName || payment.user.name || payment.user.email,
            email: payment.user.email,
            companyId: payment.user.companyIdNumber,
            vatId: payment.user.vatId,
            address: [payment.user.street, payment.user.city, payment.user.postalCode, payment.user.country].filter(Boolean).join(", "),
          },
          items: {
            create: payment.cart.items.map((item) => ({
              description: item.productName,
              quantity: item.quantity,
              unitPriceMinor: item.unitPriceMinor,
              totalMinor: item.unitPriceMinor * item.quantity,
            })),
          },
        },
      });
    }

    const recurring = Boolean(recurringMandateId) || payment.chargeKind === "MANDATE_FIRST" || payment.chargeKind === "MANDATE_REPEAT";
    const accountUrl = `${process.env.APP_URL || "http://localhost:3004"}/app/sluzba`;
    const invoiceUrl = invoice ? `${process.env.APP_URL || "http://localhost:3004"}/app/faktury/${invoice.id}` : null;
    const text = payment.amountMinor > 0
      ? `Dobrý den${payment.user.name ? ` ${payment.user.name}` : ""},\n\nplatbu ${new Intl.NumberFormat("cs-CZ", { style: "currency", currency: payment.currency }).format(payment.amountMinor / 100)} jsme přijali.${invoice ? ` Daňový doklad ${invoice.number} najdete zde: ${invoiceUrl}` : ""}\n\n${recurring ? "Roční obnovení je povolené. Novou cenu vám oznámíme nejméně 14 dní předem; bez nové analýzy a předchozího oznámení nic nestrhneme. Obnovu můžete kdykoli vypnout." : "Automatické roční obnovení pro tuto platbu není aktivní."}\n\nSpráva služby: ${accountUrl}`
      : `Dobrý den${payment.user.name ? ` ${payment.user.name}` : ""},\n\nbezplatný přístup ke službě Spottex byl aktivován. Stav služby najdete zde: ${accountUrl}`;
    await tx.emailOutbox.upsert({
      where: { idempotencyKey: `payment:${payment.id}:confirmation` },
      update: {},
      create: {
        idempotencyKey: `payment:${payment.id}:confirmation`,
        toEmail: payment.user.email,
        subject: payment.amountMinor > 0 ? "Potvrzení platby Spottex a daňový doklad" : "Služba Spottex byla aktivována",
        textBody: protectEmailBody(text),
      },
    });

    await tx.auditLog.create({ data: { actorUserId: payment.userId, action: "PAYMENT_PAID", entityType: "Payment", entityId: payment.id, metadata: { provider: payment.provider } } });
    return tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
  });
}

async function cancelTerminalGopayPayment(paymentId: string, providerPayload: Prisma.InputJsonValue) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${paymentId}))`;
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new Error("PAYMENT_NOT_FOUND");
    if (["PAID", "REFUNDED"].includes(payment.status)) return false;
    const changed = await tx.payment.updateMany({
      where: { id: payment.id, status: { in: ["CREATED", "PENDING"] } },
      data: {
        status: "CANCELED",
        providerPayload: { ...jsonObject(payment.providerPayload), ...jsonObject(providerPayload as Prisma.JsonValue) } as Prisma.InputJsonValue,
      },
    });
    if (!changed.count) return false;
    if (payment.recurringRenewalId) {
      const renewal = await tx.recurringRenewal.findUnique({
        where: { id: payment.recurringRenewalId },
        select: { attemptCount: true },
      });
      if (renewal) {
        const exhausted = renewal.attemptCount >= 3;
        await tx.recurringRenewal.updateMany({
          where: { id: payment.recurringRenewalId, status: "CHARGE_PENDING" },
          data: exhausted
            ? { status: "FAILED", completedAt: new Date(), lastError: "GoPay opakovanou platbu zamítl.", nextAttemptAt: null }
            : { status: "RETRY", lastError: "GoPay opakovanou platbu zamítl.", nextAttemptAt: new Date(Date.now() + 24 * 60 * 60_000) },
        });
      }
    }
    if (payment.cartId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(56321::int, ${payment.userId}::int)`;
      const anotherOpen = await tx.cart.findFirst({
        where: { userId: payment.userId, status: "OPEN", id: { not: payment.cartId } },
        select: { id: true },
      });
      await tx.cart.updateMany({
        where: { id: payment.cartId, status: "CHECKOUT" },
        data: { status: anotherOpen ? "CANCELED" : "OPEN" },
      });
    }
    await tx.auditLog.create({
      data: { actorUserId: payment.userId, action: "GOPAY_PAYMENT_CANCELED", entityType: "Payment", entityId: payment.id },
    });
    return true;
  });
}

async function recordGopayRefund(paymentId: string, providerPayload: Prisma.InputJsonValue) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${paymentId}))`;
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new Error("PAYMENT_NOT_FOUND");
    if (payment.status === "REFUNDED") {
      const deactivationJob = await enqueueInverterDeactivationJob(tx, {
        userId: payment.userId,
        reason: `gopay-refund-${payment.id}`,
        idempotencyKey: `gopay-refund:${payment.id}`,
      });
      return { changed: false, userId: payment.userId, deactivationJobId: deactivationJob.id };
    }
    if (payment.status !== "PAID") throw new Error("GOPAY_REFUND_WITHOUT_PAID_PAYMENT");
    const refundedAt = new Date();
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "REFUNDED",
        providerPayload: { ...jsonObject(payment.providerPayload), ...jsonObject(providerPayload as Prisma.JsonValue) } as Prisma.InputJsonValue,
      },
    });
    await tx.subscription.updateMany({
      where: { paymentId: payment.id, status: { in: ["ACTIVE", "TRIAL", "PAST_DUE"] } },
      data: { status: "CANCELED", canceledAt: refundedAt, endsAt: refundedAt },
    });
    await tx.auditLog.create({
      data: { actorUserId: payment.userId, action: "GOPAY_PAYMENT_REFUNDED", entityType: "Payment", entityId: payment.id },
    });
    const deactivationJob = await enqueueInverterDeactivationJob(tx, {
      userId: payment.userId,
      reason: `gopay-refund-${payment.id}`,
      idempotencyKey: `gopay-refund:${payment.id}`,
    });
    return { changed: true, userId: payment.userId, deactivationJobId: deactivationJob.id };
  });
}

export async function reconcileGopay(paymentId: string, notifiedProviderPaymentId?: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.provider !== "GOPAY") throw new Error("GOPAY_PAYMENT_NOT_LINKED");
  if (payment.providerPaymentId && notifiedProviderPaymentId && payment.providerPaymentId !== notifiedProviderPaymentId) {
    throw new Error("GOPAY_PAYMENT_MISMATCH");
  }
  const providerPaymentId = payment.providerPaymentId || notifiedProviderPaymentId;
  if (!providerPaymentId) throw new Error("GOPAY_PAYMENT_NOT_LINKED");
  const token = await gopayAccessToken();
  const response = await fetch(`${process.env.GOPAY_API_URL || "https://gw.sandbox.gopay.com/api"}/payments/payment/${providerPaymentId}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await response.json().catch(() => null)) as { id?: number; state?: string; amount?: number; currency?: string; order_number?: string; gw_url?: string; target?: { goid?: number } } | null;
  if (!response.ok || !data?.state) throw new Error(`GoPay status failed: ${response.status}`);
  const expectedGoId = Number(process.env.GOPAY_GO_ID);
  const matches = String(data.id ?? "") === providerPaymentId
    && data.amount === payment.amountMinor
    && data.currency === payment.currency
    && data.order_number === payment.id
    && data.target?.goid === expectedGoId;
  if (!matches) {
    await prisma.auditLog.create({ data: { actorUserId: payment.userId, action: "GOPAY_PAYMENT_MISMATCH", entityType: "Payment", entityId: payment.id } });
    throw new Error("GOPAY_PAYMENT_MISMATCH");
  }
  if (!payment.providerPaymentId) {
    const linked = await prisma.payment.updateMany({
      where: { id: payment.id, provider: "GOPAY", providerPaymentId: null, status: { in: ["CREATED", "PENDING"] } },
      data: { providerPaymentId },
    });
    if (!linked.count) {
      const current = await prisma.payment.findUnique({ where: { id: payment.id }, select: { providerPaymentId: true } });
      if (current?.providerPaymentId !== providerPaymentId) throw new Error("GOPAY_PAYMENT_MISMATCH");
    }
  }
  const previousPayload = jsonObject(payment.providerPayload);
  const recoveredGatewayUrl = safeGopayGatewayUrl(data.gw_url);
  const mergedProviderPayload = {
    ...previousPayload,
    ...data,
    state: data.state,
    ...(recoveredGatewayUrl ? { gatewayUrl: recoveredGatewayUrl } : {}),
  } as Prisma.InputJsonValue;
  if (data.state === "PAID") {
    await finalizePaidPayment(payment.id, mergedProviderPayload);
  }
  else if (["CANCELED", "TIMEOUTED"].includes(data.state)) {
    await cancelTerminalGopayPayment(payment.id, mergedProviderPayload);
  }
  else if (data.state === "REFUNDED") {
    if (!["PAID", "REFUNDED"].includes(payment.status)) {
      await finalizePaidPayment(payment.id, { ...jsonObject(mergedProviderPayload as Prisma.JsonValue), recoveredPaidBeforeRefund: true });
    }
    const refund = await recordGopayRefund(payment.id, mergedProviderPayload);
    try {
      await processInverterDeactivationJobs({
        jobIds: [refund.deactivationJobId],
        limit: 1,
      });
    } catch {
      // Reconciliation is complete and the OFF request remains durably queued
      // for the internal runner if the immediate safety attempt cannot start.
    }
  }
  else {
    if (data.state === "PARTIALLY_REFUNDED" && !["PAID", "REFUNDED"].includes(payment.status)) {
      await finalizePaidPayment(payment.id, { ...jsonObject(mergedProviderPayload as Prisma.JsonValue), recoveredPaidBeforePartialRefund: true });
    }
    await prisma.payment.update({ where: { id: payment.id }, data: { providerPayload: mergedProviderPayload } });
    if (data.state === "PARTIALLY_REFUNDED" && previousPayload.state !== "PARTIALLY_REFUNDED") {
      await prisma.auditLog.create({
        data: { actorUserId: payment.userId, action: "GOPAY_PAYMENT_PARTIALLY_REFUNDED", entityType: "Payment", entityId: payment.id },
      });
    }
  }
  // A GoPay refund can happen long after the original PAID callback. Touch a
  // still-local PAID payment after every provider check so the recovery worker
  // can round-robin through paid transactions without hammering the same row.
  // The status guard prevents a concurrent REFUNDED reconciliation from being
  // overwritten by an older PAID/CANCELED response.
  if (payment.status === "PAID" && data.state !== "REFUNDED") {
    await prisma.payment.updateMany({
      where: { id: payment.id, status: "PAID" },
      data: {
        providerPayload: {
          ...jsonObject(mergedProviderPayload as Prisma.JsonValue),
          recoveryLastAttemptAt: new Date().toISOString(),
          recoveryStatus: "VERIFIED",
        } as Prisma.InputJsonValue,
      },
    });
  }
  return data.state;
}

export async function flagUnlinkedGopayCheckoutsForReview(now = new Date(), recoveryMinutes = 30) {
  const cutoff = new Date(now.getTime() - recoveryMinutes * 60_000);
  const stale = await prisma.payment.findMany({
    where: { provider: "GOPAY", status: "PENDING", providerPaymentId: null, updatedAt: { lte: cutoff } },
    select: { id: true, userId: true, cartId: true, providerPayload: true },
    take: 200,
  });
  let flagged = 0;
  for (const payment of stale) {
    const changed = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(56321::int, ${payment.userId}::int)`;
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, provider: "GOPAY", status: "PENDING", providerPaymentId: null, updatedAt: { lte: cutoff } },
        data: {
          providerPayload: {
            ...jsonObject(payment.providerPayload),
            state: "CREATE_REVIEW_REQUIRED",
          } as Prisma.InputJsonValue,
        },
      });
      if (!claimed.count) return false;
      await tx.auditLog.create({
        data: { actorUserId: payment.userId, action: "GOPAY_CREATION_REVIEW_REQUIRED", entityType: "Payment", entityId: payment.id },
      });
      return true;
    });
    if (changed) flagged += 1;
  }
  return { scanned: stale.length, flagged };
}

export async function reconcilePendingGopayPayments(
  now = new Date(),
  recoveryMinutes = 5,
  limit = 20,
  paidRecoveryMinutes = 60,
) {
  const cutoff = new Date(now.getTime() - recoveryMinutes * 60_000);
  const paidCutoff = new Date(now.getTime() - Math.max(5, paidRecoveryMinutes) * 60_000);
  const boundedLimit = Math.min(100, Math.max(1, limit));
  const candidateSelect = { id: true, userId: true, updatedAt: true, providerPayload: true } as const;
  const [pending, paid] = await Promise.all([
    prisma.payment.findMany({
      where: {
        provider: "GOPAY",
        status: { in: ["CREATED", "PENDING"] },
        providerPaymentId: { not: null },
        updatedAt: { lte: cutoff },
      },
      select: candidateSelect,
      orderBy: { updatedAt: "asc" },
      take: boundedLimit,
    }),
    prisma.payment.findMany({
      where: {
        provider: "GOPAY",
        status: "PAID",
        providerPaymentId: { not: null },
        updatedAt: { lte: paidCutoff },
      },
      select: candidateSelect,
      // Successful and failed checks both touch updatedAt. This is a bounded,
      // persistent round-robin cursor over locally PAID GoPay payments.
      orderBy: { updatedAt: "asc" },
      take: Math.min(5, boundedLimit),
    }),
  ]);
  const candidates = [...pending, ...paid];
  let reconciled = 0;
  let settled = 0;
  let errors = 0;
  for (const payment of candidates) {
    try {
      const state = await reconcileGopay(payment.id);
      reconciled += 1;
      if (["PAID", "CANCELED", "TIMEOUTED", "REFUNDED"].includes(state)) settled += 1;
    } catch {
      errors += 1;
      await prisma.payment.updateMany({
        where: {
          id: payment.id,
          status: { in: ["CREATED", "PENDING", "PAID"] },
          providerPaymentId: { not: null },
          updatedAt: payment.updatedAt,
        },
        data: {
          providerPayload: {
            ...jsonObject(payment.providerPayload),
            recoveryLastAttemptAt: now.toISOString(),
            recoveryStatus: "ERROR",
          } as Prisma.InputJsonValue,
        },
      });
    }
  }
  return {
    scanned: candidates.length,
    pendingScanned: pending.length,
    paidScanned: paid.length,
    reconciled,
    settled,
    errors,
  };
}
