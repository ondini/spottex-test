import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { queueEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { ANALYSIS_ENGINE_VERSION, enqueueAnalysis } from "@/lib/analysis/service";

import {
  finalizePaidPayment,
  gopayAccessToken,
  reconcileGopay,
  RECURRING_MAX_AMOUNT_MINOR,
} from "./payment";
import {
  calculateRenewalAmount as calculateRenewalAmountWithCap,
  recurringRetryAt,
  RECURRING_RENEWAL_MAX_ATTEMPTS,
} from "./recurring-policy";

const DAY_MS = 86_400_000;

function object(value: Prisma.JsonValue | null | undefined): Prisma.JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Prisma.JsonObject
    : {};
}

function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("cs-CZ", { style: "currency", currency }).format(amountMinor / 100);
}

export function calculateRenewalAmount(input: {
  previousPaidMinor: number;
  latestOfferMinor?: number | null;
  mandateMaximumMinor: number;
}) {
  // A renewal is never made more expensive silently. A newer analysis may
  // lower the price, while an increase requires a new checkout and consent.
  return calculateRenewalAmountWithCap({ ...input, globalMaximumMinor: RECURRING_MAX_AMOUNT_MINOR });
}

async function scheduleUpcomingRenewals(now: Date) {
  const candidates = await prisma.subscription.findMany({
    where: {
      status: "ACTIVE",
      endsAt: { gt: now, lte: new Date(now.getTime() + 45 * DAY_MS) },
      recurringMandate: {
        is: {
          status: "ACTIVE",
          OR: [{ validUntil: null }, { validUntil: { gt: now } }],
        },
      },
    },
    include: {
      product: true,
      user: { select: { email: true } },
      payment: { include: { serviceOffer: true } },
      recurringMandate: true,
      energySite: {
        include: {
          serviceOffers: {
            where: { status: "OFFERED", validUntil: { gt: now }, analysisRunId: { not: null }, createdAt: { gte: new Date(now.getTime() - 60 * DAY_MS) } },
            include: { analysisRun: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
    },
    orderBy: { endsAt: "asc" },
    take: 200,
  });
  let scheduled = 0;
  for (const subscription of candidates) {
    if (!subscription.endsAt || !subscription.recurringMandate || !subscription.payment) continue;
    if (subscription.payment.amountMinor <= 0) continue;
    const latestOffer = subscription.energySite?.serviceOffers[0];
    const freshAnalysis = latestOffer?.analysisRun?.status === "COMPLETED" && latestOffer.analysisRun.engineVersion === ANALYSIS_ENGINE_VERSION;
    if (!latestOffer || !freshAnalysis) {
      if (subscription.energySiteId) {
        await enqueueAnalysis(subscription.userId, { siteId: subscription.energySiteId, kind: "BASE", hardwareVariants: [] }).catch(() => null);
      }
      await queueEmail({
        idempotencyKey: `recurring-renewal:${subscription.id}:fresh-analysis-required:${subscription.endsAt.toISOString()}`,
        to: subscription.user.email,
        subject: "Připravujeme nový výpočet ceny služby Spottex",
        text: `Před obnovením služby k ${subscription.endsAt.toLocaleDateString("cs-CZ", { timeZone: "Europe/Prague" })} nejdřív přepočítáme očekávanou úsporu. Bez čerstvé analýzy žádnou opakovanou platbu nestrhneme.`,
      }).catch(() => null);
      continue;
    }
    const amountMinor = calculateRenewalAmount({
      previousPaidMinor: subscription.payment.amountMinor,
      latestOfferMinor: latestOffer.finalPriceMinor,
      mandateMaximumMinor: subscription.recurringMandate.maxAmountMinor,
    });
    const created = await prisma.recurringRenewal.upsert({
      where: { subscriptionId: subscription.id },
      update: {},
      create: {
        userId: subscription.userId,
        recurringMandateId: subscription.recurringMandate.id,
        subscriptionId: subscription.id,
        productId: subscription.productId,
        amountMinor,
        currency: subscription.payment.currency,
        noticeAt: new Date(subscription.endsAt.getTime() - subscription.recurringMandate.noticeDays * DAY_MS),
        scheduledAt: subscription.endsAt,
      },
    });
    if (created.createdAt.getTime() === created.updatedAt.getTime()) scheduled += 1;
  }
  return scheduled;
}

async function sendRenewalNotices(now: Date) {
  const renewals = await prisma.recurringRenewal.findMany({
    where: { status: "SCHEDULED", noticeAt: { lte: now } },
    include: { user: { select: { email: true, name: true } }, product: { select: { name: true } } },
    orderBy: { noticeAt: "asc" },
    take: 200,
  });
  let sent = 0;
  for (const renewal of renewals) {
    await queueEmail({
      idempotencyKey: `recurring-renewal:${renewal.id}:notice`,
      to: renewal.user.email,
      subject: "Připravované roční obnovení služby Spottex",
      text: `Dobrý den${renewal.user.name ? ` ${renewal.user.name}` : ""},\n\n${renewal.product.name} bude obnovena ${renewal.scheduledAt.toLocaleDateString("cs-CZ", { timeZone: "Europe/Prague" })} za ${money(renewal.amountMinor, renewal.currency)}. Jde o předem stanovenou cenu, která nepřevyšuje 25 % očekávané úspory ani 990 Kč. Opakovanou platbu můžete před stržením kdykoli zrušit ve svém účtu.\n\n${process.env.APP_URL || "http://localhost:3004"}/app/sluzba`,
    });
    const changed = await prisma.recurringRenewal.updateMany({
      where: { id: renewal.id, status: "SCHEDULED", noticeSentAt: null },
      data: { status: "NOTICE_SENT", noticeSentAt: now },
    });
    sent += changed.count;
  }
  return sent;
}

async function sendFailedRenewalNotices() {
  const renewals = await prisma.recurringRenewal.findMany({
    where: { status: "FAILED" },
    include: { user: { select: { email: true, name: true } }, product: { select: { name: true } } },
    orderBy: { completedAt: "desc" },
    take: 200,
  });
  let sent = 0;
  for (const renewal of renewals) {
    await queueEmail({
      idempotencyKey: `recurring-renewal:${renewal.id}:failed`,
      to: renewal.user.email,
      subject: "Roční obnovení služby Spottex se nepodařilo",
      text: `Dobrý den${renewal.user.name ? ` ${renewal.user.name}` : ""},\n\nobnovení služby ${renewal.product.name} se nepodařilo a další automatický pokus už neprovedeme. Původní služba zůstává aktivní jen do konce zaplaceného období; potom bude chytré řízení bezpečně vypnuto. V účtu můžete zkontrolovat stav nebo připravit novou platbu.\n\n${process.env.APP_URL || "http://localhost:3004"}/app/sluzba`,
    });
    sent += 1;
  }
  return sent;
}

async function prepareAttempt(renewalId: string, now: Date) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${renewalId}))`;
    const renewal = await tx.recurringRenewal.findUnique({
      where: { id: renewalId },
      include: { recurringMandate: true, product: true },
    });
    if (!renewal || !["NOTICE_SENT", "RETRY"].includes(renewal.status)) return null;
    if (renewal.scheduledAt > now || (renewal.nextAttemptAt && renewal.nextAttemptAt > now)) return null;
    if (renewal.recurringMandate.status !== "ACTIVE") {
      await tx.recurringRenewal.update({ where: { id: renewal.id }, data: { status: "CANCELED", completedAt: now } });
      return null;
    }
    if (renewal.recurringMandate.validUntil && renewal.recurringMandate.validUntil <= now) {
      await tx.recurringPaymentMandate.update({ where: { id: renewal.recurringMandate.id }, data: { status: "EXPIRED" } });
      await tx.recurringRenewal.update({ where: { id: renewal.id }, data: { status: "FAILED", completedAt: now, lastError: "Souhlas s opakovanou platbou vypršel." } });
      return null;
    }
    const attempt = renewal.attemptCount + 1;
    if (attempt > RECURRING_RENEWAL_MAX_ATTEMPTS) return null;
    const claimed = await tx.recurringRenewal.updateMany({
      where: { id: renewal.id, status: renewal.status, attemptCount: renewal.attemptCount },
      data: { status: "CHARGE_PENDING", attemptCount: { increment: 1 }, nextAttemptAt: null, lastError: null },
    });
    if (!claimed.count) return null;
    const cart = await tx.cart.create({
      data: {
        userId: renewal.userId,
        status: "CHECKOUT",
        currency: renewal.currency,
        totalMinor: renewal.amountMinor,
        items: {
          create: {
            productId: renewal.productId,
            quantity: 1,
            unitPriceMinor: renewal.amountMinor,
            productName: renewal.product.name,
            metadata: { recurringRenewalId: renewal.id },
          },
        },
      },
    });
    const payment = await tx.payment.create({
      data: {
        userId: renewal.userId,
        cartId: cart.id,
        provider: renewal.recurringMandate.provider,
        status: "PENDING",
        amountMinor: renewal.amountMinor,
        currency: renewal.currency,
        idempotencyKey: `recurring-renewal:${renewal.id}:attempt:${attempt}`,
        chargeKind: "MANDATE_REPEAT",
        recurringMandateId: renewal.recurringMandateId,
        recurringRenewalId: renewal.id,
        providerPayload: { renewalId: renewal.id, attempt },
      },
    });
    return { renewal, payment, attempt };
  });
}

async function failAttempt(paymentId: string, renewalId: string, message: string, now: Date) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${renewalId}))`;
    const renewal = await tx.recurringRenewal.findUnique({ where: { id: renewalId } });
    if (!renewal || renewal.status !== "CHARGE_PENDING") return;
    const nextAttemptAt = recurringRetryAt(now, renewal.attemptCount);
    await tx.payment.updateMany({
      where: { id: paymentId, status: "PENDING", providerPaymentId: null },
      data: { status: "FAILED", providerPayload: { state: "CREATE_FAILED", error: message } },
    });
    await tx.cart.updateMany({
      where: { payments: { some: { id: paymentId } }, status: "CHECKOUT" },
      data: { status: "CANCELED" },
    });
    await tx.recurringRenewal.update({
      where: { id: renewal.id },
      data: nextAttemptAt
        ? { status: "RETRY", nextAttemptAt, lastError: message }
        : { status: "FAILED", completedAt: now, lastError: message },
    });
  });
}

async function createProviderRecurrence(prepared: NonNullable<Awaited<ReturnType<typeof prepareAttempt>>>, now: Date) {
  if (prepared.payment.provider === "MOCK") {
    await prisma.payment.update({
      where: { id: prepared.payment.id },
      data: {
        providerPaymentId: `mock-renewal-${prepared.payment.id}`,
        providerPayload: { renewalId: prepared.renewal.id, attempt: prepared.attempt, state: "PAID", mock: true },
      },
    });
    await finalizePaidPayment(prepared.payment.id, { state: "PAID", mockRecurring: true });
    return "CREATED" as const;
  }
  const token = await gopayAccessToken();
  let response: Response;
  try {
    response = await fetch(`${process.env.GOPAY_API_URL || "https://gw.sandbox.gopay.com/api"}/payments/payment/${encodeURIComponent(prepared.renewal.recurringMandate.providerParentPaymentId)}/create-recurrence`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        amount: prepared.payment.amountMinor,
        currency: prepared.payment.currency,
        order_number: prepared.payment.id,
        order_description: "Spottex – roční chytré řízení",
        items: [{ name: prepared.renewal.product.name, amount: prepared.payment.amountMinor, count: 1, type: "ITEM" }],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    await prisma.payment.updateMany({
      where: { id: prepared.payment.id, status: "PENDING", providerPaymentId: null },
      data: { providerPayload: { renewalId: prepared.renewal.id, attempt: prepared.attempt, state: "CREATE_UNCERTAIN" } },
    });
    return "UNCERTAIN" as const;
  }
  const data = (await response.json().catch(() => null)) as { id?: number; state?: string; parent_id?: number } | null;
  if (!response.ok) {
    if (response.status >= 500 || [408, 409, 425, 429].includes(response.status)) {
      await prisma.payment.update({
        where: { id: prepared.payment.id },
        data: { providerPayload: { renewalId: prepared.renewal.id, attempt: prepared.attempt, state: "CREATE_UNCERTAIN", httpStatus: response.status } },
      });
      return "UNCERTAIN" as const;
    }
    await failAttempt(prepared.payment.id, prepared.renewal.id, `GoPay create recurrence failed: ${response.status}`, now);
    return "FAILED" as const;
  }
  if (!data?.id || String(data.parent_id ?? "") !== prepared.renewal.recurringMandate.providerParentPaymentId) {
    await prisma.payment.update({
      where: { id: prepared.payment.id },
      data: { providerPayload: { renewalId: prepared.renewal.id, attempt: prepared.attempt, state: "CREATE_UNCERTAIN", providerResponseInvalid: true } },
    });
    return "UNCERTAIN" as const;
  }
  await prisma.payment.update({
    where: { id: prepared.payment.id },
    data: {
      providerPaymentId: String(data.id),
      providerPayload: { renewalId: prepared.renewal.id, attempt: prepared.attempt, ...data },
    },
  });
  await reconcileGopay(prepared.payment.id).catch(() => null);
  return "CREATED" as const;
}

export async function processRecurringRenewalById(renewalId: string, now = new Date()) {
  const prepared = await prepareAttempt(renewalId, now);
  if (!prepared) return "SKIPPED" as const;
  try {
    return await createProviderRecurrence(prepared, now);
  } catch (error) {
    await failAttempt(
      prepared.payment.id,
      prepared.renewal.id,
      error instanceof Error ? error.message.slice(0, 500) : "GoPay recurrence failed",
      now,
    );
    return "FAILED" as const;
  }
}

export async function processRecurringRenewals(now = new Date()) {
  const scheduled = await scheduleUpcomingRenewals(now);
  const notices = await sendRenewalNotices(now);
  const due = await prisma.recurringRenewal.findMany({
    where: {
      status: { in: ["NOTICE_SENT", "RETRY"] },
      scheduledAt: { lte: now },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    select: { id: true },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
    take: 10,
  });
  let created = 0;
  let failed = 0;
  let uncertain = 0;
  for (const row of due) {
    const result = await processRecurringRenewalById(row.id, now);
    if (result === "CREATED") created += 1;
    if (result === "FAILED") failed += 1;
    if (result === "UNCERTAIN") uncertain += 1;
  }
  const failureNotices = await sendFailedRenewalNotices();
  return { scheduled, notices, failureNotices, due: due.length, created, failed, uncertain };
}

export async function revokeRecurringMandate(userId: number, mandateId: string) {
  const mandate = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${mandateId}))`;
    const current = await tx.recurringPaymentMandate.findFirst({ where: { id: mandateId, userId } });
    if (!current) throw new Error("RECURRING_MANDATE_NOT_FOUND");
    if (current.status === "REVOKED") return current;
    const now = new Date();
    const updated = await tx.recurringPaymentMandate.update({
      where: { id: current.id },
      data: { status: "REVOKED", revokedAt: now },
    });
    await tx.recurringRenewal.updateMany({
      where: { recurringMandateId: current.id, status: { in: ["SCHEDULED", "NOTICE_SENT", "RETRY"] } },
      data: { status: "CANCELED", completedAt: now, nextAttemptAt: null },
    });
    await tx.auditLog.create({
      data: { actorUserId: userId, action: "RECURRING_MANDATE_REVOKED", entityType: "RecurringPaymentMandate", entityId: mandateId },
    });
    return updated;
  });
  if (mandate.status === "REVOKED" && mandate.revokedAt && mandate.revokedAt < new Date(Date.now() - 1_000)) {
    return { mandate, providerConfirmed: object(mandate.metadata).providerCancellation === "FINISHED" };
  }
  let providerConfirmed = false;
  let providerResult = "LOCAL_ONLY";
  try {
    const token = await gopayAccessToken();
    const response = await fetch(`${process.env.GOPAY_API_URL || "https://gw.sandbox.gopay.com/api"}/payments/payment/${encodeURIComponent(mandate.providerParentPaymentId)}/void-recurrence`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await response.json().catch(() => null)) as { result?: string } | null;
    providerResult = data?.result || `HTTP_${response.status}`;
    providerConfirmed = response.ok && data?.result === "FINISHED";
  } catch {
    providerResult = "PROVIDER_UNREACHABLE";
  }
  await prisma.recurringPaymentMandate.update({
    where: { id: mandate.id },
    data: { metadata: { ...object(mandate.metadata), providerCancellation: providerResult, providerCancellationAt: new Date().toISOString(), requestId: randomUUID() } },
  });
  return { mandate, providerConfirmed };
}
