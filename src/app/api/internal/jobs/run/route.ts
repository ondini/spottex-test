import { createHash, randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { processEmailOutbox } from "@/lib/email";
import { processConsultationCalendarJobs } from "@/lib/consultation/calendar-sync";
import { releaseExpiredConsultationHolds } from "@/lib/consultation/service";
import { prisma } from "@/lib/prisma";
import { runDataRetention } from "@/lib/retention";
import { queueEmail } from "@/lib/email";
import {
  reconcileEntitledInverterCommands,
  syncConnectedEnergySites,
} from "@/lib/energy/service";
import {
  enqueueInverterDeactivationJob,
  processInverterDeactivationJobs,
} from "@/lib/energy/deactivation-jobs";
import {
  flagUnlinkedGopayCheckoutsForReview,
  reconcilePendingGopayPayments,
} from "@/lib/commerce/payment";
import { processSimulationJobs } from "@/lib/simulation/service";
import { processRecurringRenewals } from "@/lib/commerce/recurring";
import { processHistoryImportJobs } from "@/lib/energy/history-import";
import { monitorCatalogExpirations } from "@/lib/pricing/expiry-monitor";
import { syncBackendMarketPrices } from "@/lib/pricing/backend-market-source";
import { syncCostsEnergyCatalog } from "@/lib/costs/catalog-sync";

const RUNNER_LEASE_KEY = "internal-job-runner:lease";

async function acquireRunnerLease() {
  const now = new Date();
  const owner = `lease:${randomUUID()}`;
  const lease = await prisma.scheduledJob.upsert({
    where: { idempotencyKey: RUNNER_LEASE_KEY },
    update: {},
    create: { type: "INTERNAL_JOB_RUNNER_LEASE", idempotencyKey: RUNNER_LEASE_KEY, runAt: now },
    select: { id: true },
  });
  const claimed = await prisma.scheduledJob.updateMany({
    where: {
      id: lease.id,
      OR: [
        { status: { not: "RUNNING" } },
        { lockedAt: null },
        { lockedAt: { lt: new Date(now.getTime() - 50 * 60_000) } },
      ],
    },
    data: { status: "RUNNING", lockedAt: now, lastError: owner, attempts: { increment: 1 }, completedAt: null },
  });
  return claimed.count ? { id: lease.id, owner } : null;
}

async function releaseRunnerLease(lease: { id: string; owner: string }) {
  await prisma.scheduledJob.updateMany({
    where: { id: lease.id, status: "RUNNING", lastError: lease.owner },
    data: { status: "PENDING", lockedAt: null, lastError: null, completedAt: new Date(), runAt: new Date(Date.now() + 30_000) },
  });
}

async function heartbeatRunnerLease(lease: { id: string; owner: string }) {
  const heartbeat = await prisma.scheduledJob.updateMany({
    where: { id: lease.id, status: "RUNNING", lastError: lease.owner },
    data: { lockedAt: new Date() },
  });
  if (!heartbeat.count) throw new Error("INTERNAL_JOB_RUNNER_LEASE_LOST");
}

async function runJobs(lease: { id: string; owner: string }) {
  await heartbeatRunnerLease(lease);
  const consultation = await releaseExpiredConsultationHolds();
  await heartbeatRunnerLease(lease);
  const calendarSync = await processConsultationCalendarJobs({ limit: 5 });
  await heartbeatRunnerLease(lease);
  const paymentRecovery = await flagUnlinkedGopayCheckoutsForReview();
  await heartbeatRunnerLease(lease);
  const paymentReconciliation = await reconcilePendingGopayPayments(new Date(), 5, 10);
  await heartbeatRunnerLease(lease);
  const now = new Date();
  const recurringRenewals = await processRecurringRenewals(now);
  await heartbeatRunnerLease(lease);
  const endingSoon = await prisma.subscription.findMany({
    where: { status: { in: ["ACTIVE", "TRIAL"] }, endsAt: { gt: now, lte: new Date(now.getTime() + 3 * 86_400_000) } },
    include: { user: { select: { email: true, name: true } }, product: { select: { name: true } } },
    take: 500,
  });
  await Promise.all(endingSoon.map((subscription) => queueEmail({
    idempotencyKey: `subscription:${subscription.id}:ending-soon`,
    to: subscription.user.email,
    subject: "Platnost služby Spottex se blíží ke konci",
    text: `Dobrý den${subscription.user.name ? ` ${subscription.user.name}` : ""},\n\nslužba ${subscription.product.name} končí ${subscription.endsAt?.toLocaleDateString("cs-CZ")}. Navazující aktivaci a vyúčtování najdete ve svém účtu nebo je s vámi vyřeší podpora Spottex.\n\n${process.env.APP_URL || "http://localhost:3004"}/app/sluzba`,
  })));
  await heartbeatRunnerLease(lease);
  const expiring = await prisma.subscription.findMany({
    where: { status: { in: ["ACTIVE", "TRIAL"] }, endsAt: { lte: now } },
    include: {
      user: { select: { email: true, name: true } },
      product: { select: { name: true } },
      recurringRenewal: { select: { status: true, scheduledAt: true } },
    },
    take: 50,
  });
  const expirable = expiring.filter((subscription) => {
    const renewal = subscription.recurringRenewal;
    if (!renewal || !["NOTICE_SENT", "CHARGE_PENDING", "RETRY"].includes(renewal.status)) return true;
    return renewal.scheduledAt.getTime() + 7 * 86_400_000 <= now.getTime();
  });
  const expiration = await prisma.$transaction(async (tx) => {
    const expiredIds: string[] = [];
    const deactivationJobIds: string[] = [];
    for (const subscription of expirable) {
      const changed = await tx.subscription.updateMany({
        where: {
          id: subscription.id,
          status: { in: ["ACTIVE", "TRIAL"] },
          endsAt: { lte: now },
        },
        data: { status: "EXPIRED" },
      });
      if (!changed.count) continue;
      expiredIds.push(subscription.id);
      const job = await enqueueInverterDeactivationJob(tx, {
        userId: subscription.userId,
        reason: `subscription-expired-${subscription.id}`,
        idempotencyKey: `subscription-expired:${subscription.id}`,
      });
      deactivationJobIds.push(job.id);
    }
    return { count: expiredIds.length, expiredIds, deactivationJobIds };
  }, { maxWait: 5_000, timeout: 30_000 });
  const expiredSubscriptions = expiring.filter((subscription) =>
    expiration.expiredIds.includes(subscription.id),
  );
  await heartbeatRunnerLease(lease);
  const deactivations = await processInverterDeactivationJobs({
    limit: 2,
    onHeartbeat: () => heartbeatRunnerLease(lease),
  });
  await heartbeatRunnerLease(lease);
  const energyReconciliation = await reconcileEntitledInverterCommands({ limit: 5 });
  await heartbeatRunnerLease(lease);
  const energySync = await syncConnectedEnergySites({ limit: 3 });
  await heartbeatRunnerLease(lease);
  const marketSync = await syncBackendMarketPrices().catch((error) => ({
    configured: true,
    status: "FAILED" as const,
    confirmedIntervals: 0,
    predictedIntervals: 0,
    validFrom: null,
    validTo: null,
    seriesId: null,
    error: error instanceof Error ? error.message : "MARKET_SYNC_FAILED",
  }));
  await heartbeatRunnerLease(lease);
  const costsCatalogSync = await syncCostsEnergyCatalog().catch((error) => ({
    configured: true,
    status: "FAILED" as const,
    snapshotAsOf: null,
    received: 0,
    importedDrafts: 0,
    skippedIncomplete: 0,
    error: error instanceof Error ? error.message : "COSTS_SYNC_FAILED",
  }));
  await heartbeatRunnerLease(lease);
  const historyImports = await processHistoryImportJobs({ limit: 3, onHeartbeat: () => heartbeatRunnerLease(lease) });
  await heartbeatRunnerLease(lease);
  const simulations = await processSimulationJobs({
    limit: 1,
    onHeartbeat: () => heartbeatRunnerLease(lease),
  });
  await heartbeatRunnerLease(lease);
  const catalogExpirations = await monitorCatalogExpirations(now);
  await heartbeatRunnerLease(lease);
  await Promise.all(expiredSubscriptions.map((subscription) => queueEmail({
    idempotencyKey: `subscription:${subscription.id}:expired`,
    to: subscription.user.email,
    subject: "Služba Spottex skončila",
    text: `Dobrý den${subscription.user.name ? ` ${subscription.user.name}` : ""},\n\nplatnost služby ${subscription.product.name} skončila a systém zahájil bezpečné vypnutí chytrého řízení. Stav zařízení, naměřená data a historii najdete ve svém účtu. Pokud stav neodpovídá očekávání, zařízení ověřte a kontaktujte podporu Spottex.\n\n${process.env.APP_URL || "http://localhost:3004"}/app/sluzba`,
  })));
  const retriedDeactivationUsers = deactivations.outcomes
    .filter((result) => result.status === "RETRIED")
    .map((result) => result.userId)
    .filter((userId): userId is number => userId !== null);
  const alertLines = [
    ...(calendarSync.failed ? [`Google Calendar: ${calendarSync.failed} synchronizací po posledním pokusu selhalo.`] : []),
    ...(paymentRecovery.flagged ? [`GoPay: ${paymentRecovery.flagged} vytvoření platby vyžaduje ruční kontrolu.`] : []),
    ...(paymentReconciliation.errors ? [`GoPay: ${paymentReconciliation.errors} rozpracovaných plateb se nepodařilo ověřit.`] : []),
    ...(recurringRenewals.failed ? [`GoPay: ${recurringRenewals.failed} pokusů o roční obnovení skončilo chybou.`] : []),
    ...(recurringRenewals.uncertain ? [`GoPay: u ${recurringRenewals.uncertain} obnovení není jistý výsledek vytvoření; opakování je bezpečně pozastavené do kontroly.`] : []),
    ...(retriedDeactivationUsers.length ? [`Střídače: OFF zatím není potvrzen u user ID ${retriedDeactivationUsers.join(", ")}; durable retry zůstává aktivní.`] : []),
    ...(energyReconciliation.errors ? [`Střídače: ${energyReconciliation.errors} reconciliačních pokusů skončilo chybou.`] : []),
    ...(energySync.errors ? [`Energetická data: ${energySync.errors} read-only synchronizací skončilo chybou.`] : []),
    ...(marketSync.status === "FAILED" ? [`Spotové ceny: synchronizace z backendu selhala (${marketSync.error}).`] : []),
    ...(costsCatalogSync.status === "FAILED" ? [`Ceníky: synchronizace z Costs selhala (${costsCatalogSync.error}).`] : []),
    ...(historyImports.failed ? [`Historický import: ${historyImports.failed} bloků po posledním pokusu selhalo.`] : []),
    ...(simulations.failed ? [`Simulace: ${simulations.failed} výpočtů skončilo chybou.`] : []),
  ];
  if (alertLines.length) {
    const admins = await prisma.user.findMany({ where: { role: "ADMIN", status: "ACTIVE" }, select: { id: true, email: true }, take: 20 });
    const hourBucket = Math.floor(now.getTime() / 3_600_000);
    const alertDigest = createHash("sha256").update(alertLines.join("|")).digest("hex").slice(0, 24);
    await Promise.all(admins.map((admin) => queueEmail({
      idempotencyKey: `operations-alert:${admin.id}:${hourBucket}:${alertDigest}`,
      to: admin.email,
      subject: "Spottex vyžaduje provozní zásah",
      text: `Automatická kontrola platformy zjistila stav vyžadující zásah:\n\n${alertLines.join("\n")}\n\nPodrobnosti jsou v administraci a auditním logu.`,
    })));
  }
  await heartbeatRunnerLease(lease);
  const email = await processEmailOutbox(10);
  await heartbeatRunnerLease(lease);
  const retention = await runDataRetention();
  await heartbeatRunnerLease(lease);
  return {
    ok: true,
    consultation,
    calendarSync,
    paymentRecovery,
    paymentReconciliation,
    recurringRenewals,
    subscriptionsExpired: expiration.count,
    deactivationJobsEnqueued: expiration.deactivationJobIds.length,
    deactivations,
    energyReconciliation,
    energySync,
    marketSync,
    costsCatalogSync,
    historyImports,
    simulations,
    catalogExpirations,
    email,
    retention,
  };
}

export async function POST(request: NextRequest) {
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!process.env.INTERNAL_JOB_TOKEN || supplied !== process.env.INTERNAL_JOB_TOKEN) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const lease = await acquireRunnerLease();
  if (!lease) {
    return NextResponse.json({ error: "ALREADY_RUNNING" }, { status: 409, headers: { "Retry-After": "30" } });
  }
  try {
    return NextResponse.json(await runJobs(lease));
  } finally {
    await releaseRunnerLease(lease);
  }
}
