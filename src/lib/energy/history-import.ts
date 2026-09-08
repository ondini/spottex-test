import "server-only";

import { randomUUID } from "node:crypto";

import { EnergyIntervalKind, EnergyProvider, JobStatus, Prisma } from "@prisma/client";
import { z } from "zod";

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { supersedeSiteAnalyses } from "@/lib/analysis/invalidation";
import { prisma } from "@/lib/prisma";

import { getEnergyDataQuality, invalidateEnergyDataQualityCache } from "./data-quality";
import { accessTokenExpiresAt, LegacySpottexClient } from "./legacy-client";
import { upsertMeasuredIntervalsBulk } from "./interval-write";
import { EnergyError, type LegacyTokenSet } from "./types";

export const ENERGY_HISTORY_CHUNK_JOB = "ENERGY_HISTORY_CHUNK_V1";
// Twenty days stays below the encrypted endpoint's 2,000-point limit
// (20 × 96 = 1,920 quarter-hours) while keeping multi-plant imports tractable.
const CHUNK_MS = 20 * 24 * 60 * 60_000;
const HISTORY_STALE_LOCK_MS = 30 * 60_000;

const payloadSchema = z.object({ version: z.literal(1), chunkId: z.string().min(1) }).strict();
const responseSchema = z.union([
  z.array(z.unknown()),
  z.object({ intervals: z.array(z.unknown()) }).passthrough(),
]).transform((value) => Array.isArray(value) ? value : value.intervals).pipe(z.array(z.object({
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  productionKwh: z.number().finite().nonnegative(),
  consumptionKwh: z.number().finite().nonnegative(),
  batteryKwh: z.number().finite().nullable().optional(),
  gridImportKwh: z.number().finite().nonnegative().optional(),
  gridExportKwh: z.number().finite().nonnegative().optional(),
}).strict()).max(2_000));

/**
 * Raised when the upstream has not prepared a range yet. It is a wait, not a
 * fault, and it reads that way wherever the chunk's last error is surfaced.
 */
export class HistoryChunkEmptyError extends Error {
  constructor(from: Date, to: Date) {
    super(
      `Cloud zatím nemá připravená data za období ${from.toISOString().slice(0, 10)} – ${to.toISOString().slice(0, 10)}. Zkusíme je načíst znovu.`,
    );
    this.name = "HistoryChunkEmptyError";
  }
}

export function shouldRetryEmptyHistoryChunk(input: {
  attempts: number;
  maxAttempts: number;
  hasLaterSuccessfulChunk: boolean;
}) {
  return input.attempts < input.maxAttempts && !input.hasLaterSuccessfulChunk;
}

export function historyChunks(from: Date, to: Date, chunkMs = CHUNK_MS) {
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from || chunkMs <= 0) throw new Error("HISTORY_IMPORT_INVALID_WINDOW");
  const chunks: Array<{ from: Date; to: Date }> = [];
  for (let cursor = from.getTime(); cursor < to.getTime(); cursor += chunkMs) {
    chunks.push({ from: new Date(cursor), to: new Date(Math.min(to.getTime(), cursor + chunkMs)) });
  }
  return chunks;
}

type HistoryTokenClient = Pick<
  LegacySpottexClient,
  "fetchHistoricalIntervals" | "getTokens"
>;

/**
 * A refresh token can rotate before the history endpoint reports that its
 * cache is ready. Persist the rotated pair even when that endpoint then
 * rejects the request; otherwise every retry starts with the invalidated pair
 * and can never recover without reconnecting the SolaX account.
 */
export async function fetchHistoryWithDurableTokens(
  connection: { id: number; encryptedRefreshToken: string | null },
  before: LegacyTokenSet,
  client: HistoryTokenClient,
  deviceId: string,
  from: Date,
  to: Date,
) {
  try {
    return await client.fetchHistoricalIntervals(deviceId, from, to);
  } finally {
    const after = client.getTokens();
    if (
      after &&
      (after.accessToken !== before.accessToken ||
        after.refreshToken !== before.refreshToken)
    ) {
      // Do not overwrite a still newer token pair saved by a concurrent
      // dashboard request.
      await prisma.energyConnection.updateMany({
        where: {
          id: connection.id,
          encryptedRefreshToken: connection.encryptedRefreshToken,
        },
        data: {
          encryptedAccessToken: encryptSecret(after.accessToken),
          encryptedRefreshToken: encryptSecret(after.refreshToken),
          tokenExpiresAt: accessTokenExpiresAt(after.accessToken),
        },
      });
    }
  }
}

export async function requestHistoryImport(userId: number, siteId: number, days = 365) {
  const site = await prisma.energySite.findFirst({ where: { id: siteId, userId }, include: { inverters: { orderBy: { id: "asc" } } } });
  if (!site) throw new EnergyError("SITE_NOT_FOUND", "Elektrárna nebyla nalezena.", 404);
  if (!site.inverters.length) throw new EnergyError("INVERTER_NOT_FOUND", "Elektrárna zatím nemá připojený střídač.", 404);
  if (site.provider !== EnergyProvider.LEGACY_SPOTTEX) throw new EnergyError("INVALID_REQUEST", "Historický import je nyní dostupný jen pro připojený SolaX účet.", 422);
  const active = await prisma.energyHistoryImport.findFirst({ where: { energySiteId: site.id, status: { in: ["QUEUED", "RUNNING"] } }, orderBy: { createdAt: "desc" } });
  if (active) return active;
  const requestedTo = new Date(Math.floor(Date.now() / 900_000) * 900_000);
  const requestedFrom = new Date(requestedTo.getTime() - Math.min(366, Math.max(7, days)) * 86_400_000);
  const chunks = historyChunks(requestedFrom, requestedTo);
  return prisma.$transaction(async (tx) => {
    const runs = [];
    for (const inverter of site.inverters) {
      const run = await tx.energyHistoryImport.create({
        data: { energySiteId: site.id, inverterId: inverter.id, requestedFrom, requestedTo, totalChunks: chunks.length },
      });
      runs.push(run);
      for (const chunk of chunks) {
        const row = await tx.energyHistoryImportChunk.create({
          data: {
            importId: run.id,
            chunkFrom: chunk.from,
            chunkTo: chunk.to,
            // The legacy backend prepares a long SolaX history in resumable,
            // rate-limited slices. Keep the new-app chunk alive long enough to
            // meet that producer instead of accepting a premature empty result.
            maxAttempts: 8,
          },
        });
        await tx.scheduledJob.create({ data: { type: ENERGY_HISTORY_CHUNK_JOB, idempotencyKey: `energy-history:${row.id}`, payload: { version: 1, chunkId: row.id }, runAt: new Date() } });
      }
    }
    const primaryRun = runs[0];
    await tx.auditLog.create({ data: { actorUserId: userId, action: "ENERGY_HISTORY_IMPORT_REQUESTED", entityType: "EnergyHistoryImport", entityId: primaryRun.id, metadata: { siteId: site.id, from: requestedFrom.toISOString(), to: requestedTo.toISOString(), chunksPerInverter: chunks.length, inverterIds: site.inverters.map((inverter) => inverter.id) } } });
    return primaryRun;
  }, { timeout: 60_000 });
}

async function refreshRun(importId: string) {
  const [grouped, lastFailed] = await Promise.all([
    prisma.energyHistoryImportChunk.groupBy({ by: ["status"], where: { importId }, _count: { _all: true }, _sum: { importedPoints: true } }),
    prisma.energyHistoryImportChunk.findFirst({ where: { importId, lastError: { not: null } }, orderBy: { updatedAt: "desc" }, select: { lastError: true } }),
  ]);
  const count = (status: string) => grouped.find((item) => item.status === status)?._count._all ?? 0;
  const succeededChunks = count("SUCCEEDED");
  const failedChunks = count("FAILED");
  const remaining = count("PENDING") + count("RUNNING");
  const status = remaining > 0 ? "RUNNING" : failedChunks > 0 && succeededChunks > 0 ? "PARTIAL" : failedChunks > 0 ? "FAILED" : "COMPLETED";
  await prisma.energyHistoryImport.update({
    where: { id: importId },
    data: { status, succeededChunks, failedChunks, importedPoints: grouped.reduce((sum, item) => sum + (item._sum.importedPoints ?? 0), 0), lastError: lastFailed?.lastError ?? null, ...(remaining === 0 ? { completedAt: new Date() } : {}) },
  });
  if (remaining === 0) await maybeEnqueueBaseAnalysis(importId);
}

async function maybeEnqueueBaseAnalysis(importId: string) {
  const completedImport = await prisma.energyHistoryImport.findUnique({
    where: { id: importId },
    select: {
      energySiteId: true,
      requestedFrom: true,
      requestedTo: true,
      energySite: { select: { userId: true } },
    },
  });
  if (!completedImport) return;
  const batch = await prisma.energyHistoryImport.findMany({
    where: {
      energySiteId: completedImport.energySiteId,
      requestedFrom: completedImport.requestedFrom,
      requestedTo: completedImport.requestedTo,
    },
    select: { status: true },
  });
  const terminal = batch.length > 0 && batch.every((item) =>
    ["COMPLETED", "PARTIAL", "FAILED", "CANCELED"].includes(item.status),
  );
  const hasUsableHistory = batch.some((item) =>
    item.status === "COMPLETED" || item.status === "PARTIAL",
  );
  if (!terminal || !hasUsableHistory) return;
  try {
    const { enqueueAnalysis } = await import("@/lib/analysis/service");
    const analysis = await enqueueAnalysis(completedImport.energySite.userId, {
      siteId: completedImport.energySiteId,
      kind: "BASE",
      hardwareVariants: [],
    });
    await prisma.auditLog.create({
      data: {
        actorUserId: completedImport.energySite.userId,
        action: "ENERGY_BASE_ANALYSIS_AUTO_QUEUED",
        entityType: "EnergyAnalysisRun",
        entityId: analysis.id,
        metadata: { energySiteId: completedImport.energySiteId, historyImportId: importId },
      },
    });
  } catch (error) {
    await prisma.auditLog.create({
      data: {
        actorUserId: completedImport.energySite.userId,
        action: "ENERGY_BASE_ANALYSIS_AUTO_DEFERRED",
        entityType: "EnergyHistoryImport",
        entityId: importId,
        metadata: {
          energySiteId: completedImport.energySiteId,
          reason: error instanceof Error ? error.message.slice(0, 300) : "ANALYSIS_AUTO_QUEUE_FAILED",
        },
      },
    });
  }
}

async function importChunk(chunkId: string) {
  const chunk = await prisma.energyHistoryImportChunk.findUnique({
    where: { id: chunkId },
    include: { historyImport: { include: { energySite: true, inverter: true } } },
  });
  if (!chunk || chunk.status !== "RUNNING") throw new Error("HISTORY_CHUNK_NOT_CLAIMED");
  const run = chunk.historyImport;
  const connection = await prisma.energyConnection.findUnique({ where: { userId_provider: { userId: run.energySite.userId, provider: EnergyProvider.LEGACY_SPOTTEX } } });
  if (!connection?.encryptedAccessToken || !connection.encryptedRefreshToken) throw new Error("HISTORY_CONNECTION_MISSING");
  const before = { accessToken: decryptSecret(connection.encryptedAccessToken), refreshToken: decryptSecret(connection.encryptedRefreshToken) };
  const client = new LegacySpottexClient({ tokens: before });
  const values = responseSchema.parse(
    await fetchHistoryWithDurableTokens(
      connection,
      before,
      client,
      run.inverter.externalDeviceId,
      chunk.chunkFrom,
      chunk.chunkTo,
    ),
  );
  // The backend downloads a freshly connected SolaX plant in resumable slices
  // that can take hours, and answers ranges it has not reached yet with an
  // empty list rather than an error. Accepting that as "no data" is what left
  // eight months missing from a plant whose history the backend did hold, and
  // it silently skewed every figure derived from the gap. An empty past range
  // is therefore retried on the existing budget and only believed once the
  // budget is spent.
  const laterSuccessfulChunk = values.length === 0
    ? await prisma.energyHistoryImportChunk.findFirst({
        where: {
          importId: chunk.importId,
          status: "SUCCEEDED",
          importedPoints: { gt: 0 },
          chunkFrom: { gte: chunk.chunkTo },
        },
        select: { id: true },
      })
    : null;
  if (
    values.length === 0 &&
    shouldRetryEmptyHistoryChunk({
      attempts: chunk.attempts,
      maxAttempts: chunk.maxAttempts,
      hasLaterSuccessfulChunk: laterSuccessfulChunk !== null,
    })
  ) {
    throw new HistoryChunkEmptyError(chunk.chunkFrom, chunk.chunkTo);
  }
  for (const value of values) {
    const startAt = new Date(value.startAt);
    const endAt = new Date(value.endAt);
    if (startAt < chunk.chunkFrom || endAt > chunk.chunkTo || endAt.getTime() - startAt.getTime() !== 900_000) throw new Error("HISTORY_INTERVAL_OUTSIDE_CHUNK");
  }
  await prisma.$transaction(async (tx) => {
    await upsertMeasuredIntervalsBulk(
      tx,
      values.flatMap((value) => {
        const startAt = new Date(value.startAt);
        const endAt = new Date(value.endAt);
        return [
          { inverterId: run.inverterId, kind: EnergyIntervalKind.PRODUCTION, startAt, endAt, kwh: value.productionKwh, predicted: false, correctionReason: "HISTORY_REIMPORT", sourceReference: chunk.id },
          { inverterId: run.inverterId, kind: EnergyIntervalKind.CONSUMPTION, startAt, endAt, kwh: value.consumptionKwh, predicted: false, correctionReason: "HISTORY_REIMPORT", sourceReference: chunk.id },
          ...(value.batteryKwh == null ? [] : [{ inverterId: run.inverterId, kind: EnergyIntervalKind.BATTERY, startAt, endAt, kwh: value.batteryKwh, predicted: false, correctionReason: "HISTORY_REIMPORT", sourceReference: chunk.id }]),
          ...(value.gridImportKwh == null ? [] : [{ inverterId: run.inverterId, kind: EnergyIntervalKind.GRID_IMPORT, startAt, endAt, kwh: value.gridImportKwh, predicted: false, correctionReason: "HISTORY_REIMPORT", sourceReference: chunk.id }]),
          ...(value.gridExportKwh == null ? [] : [{ inverterId: run.inverterId, kind: EnergyIntervalKind.GRID_EXPORT, startAt, endAt, kwh: value.gridExportKwh, predicted: false, correctionReason: "HISTORY_REIMPORT", sourceReference: chunk.id }]),
        ];
      }),
    );
    await supersedeSiteAnalyses(tx, {
      energySiteId: run.energySiteId,
      reason: "Historická data elektrárny byla znovu načtena.",
      actorUserId: run.energySite.userId,
    });
    await tx.energyHistoryImportChunk.update({ where: { id: chunk.id }, data: { status: "SUCCEEDED", importedPoints: values.length, completedAt: new Date(), lastError: null } });
  }, { timeout: 120_000 });
  invalidateEnergyDataQualityCache(run.energySiteId);
  await refreshRun(run.id);
}

export async function recoverStaleHistoryImportJobs(now = new Date(), jobIds?: string[]) {
  const staleBefore = new Date(now.getTime() - HISTORY_STALE_LOCK_MS);
  const staleJobs = await prisma.scheduledJob.findMany({
    where: { type: ENERGY_HISTORY_CHUNK_JOB, status: JobStatus.RUNNING, lockedAt: { lt: staleBefore }, ...(jobIds ? { id: { in: jobIds } } : {}) },
    select: { id: true, payload: true },
    take: 200,
  });
  let recovered = 0;
  let failed = 0;
  const touchedImports = new Set<string>();
  for (const job of staleJobs) {
    const payload = payloadSchema.safeParse(job.payload);
    if (!payload.success) {
      await prisma.scheduledJob.update({ where: { id: job.id }, data: { status: JobStatus.FAILED, lockedAt: null, completedAt: now, lastError: "HISTORY_JOB_PAYLOAD_INVALID_AFTER_RECOVERY" } });
      failed += 1;
      continue;
    }
    const chunk = await prisma.energyHistoryImportChunk.findUnique({ where: { id: payload.data.chunkId } });
    if (!chunk || chunk.status !== "RUNNING") {
      await prisma.scheduledJob.update({ where: { id: job.id }, data: { status: JobStatus.FAILED, lockedAt: null, completedAt: now, lastError: "HISTORY_CHUNK_MISSING_AFTER_RECOVERY" } });
      failed += 1;
      continue;
    }
    touchedImports.add(chunk.importId);
    const canRetry = chunk.attempts < chunk.maxAttempts;
    await prisma.$transaction([
      prisma.energyHistoryImportChunk.update({ where: { id: chunk.id }, data: canRetry ? { status: "PENDING", lastError: "Obnoveno po přerušeném importu.", startedAt: null } : { status: "FAILED", lastError: "Import byl opakovaně přerušen.", completedAt: now } }),
      prisma.scheduledJob.update({ where: { id: job.id }, data: canRetry ? { status: JobStatus.PENDING, runAt: now, lockedAt: null, lastError: "Recovered interrupted history import" } : { status: JobStatus.FAILED, lockedAt: null, completedAt: now, lastError: "History import repeatedly interrupted" } }),
    ]);
    if (canRetry) recovered += 1;
    else failed += 1;
  }
  for (const importId of touchedImports) await refreshRun(importId);
  return { scanned: staleJobs.length, recovered, failed };
}

export async function retryHistoryImport(adminUserId: number, importId: string) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.energyHistoryImport.findUnique({ where: { id: importId }, include: { chunks: { where: { status: "FAILED" } } } });
    if (!run) throw new Error("HISTORY_IMPORT_NOT_FOUND");
    if (!run.chunks.length) throw new Error("HISTORY_IMPORT_NOT_RETRYABLE");
    for (const chunk of run.chunks) {
      await tx.energyHistoryImportChunk.update({ where: { id: chunk.id }, data: { status: "PENDING", attempts: 0, lastError: null, startedAt: null, completedAt: null } });
      await tx.scheduledJob.upsert({ where: { idempotencyKey: `energy-history:${chunk.id}` }, update: { status: JobStatus.PENDING, runAt: new Date(), attempts: 0, lockedAt: null, lastError: null, completedAt: null }, create: { type: ENERGY_HISTORY_CHUNK_JOB, idempotencyKey: `energy-history:${chunk.id}`, payload: { version: 1, chunkId: chunk.id }, runAt: new Date() } });
    }
    const updated = await tx.energyHistoryImport.update({ where: { id: run.id }, data: { status: "QUEUED", failedChunks: 0, lastError: null, completedAt: null } });
    await tx.auditLog.create({ data: { actorUserId: adminUserId, action: "ENERGY_HISTORY_IMPORT_RETRIED", entityType: "EnergyHistoryImport", entityId: run.id, metadata: { chunks: run.chunks.length } } });
    return updated;
  });
}

export async function processHistoryImportJobs(options: { limit?: number; onHeartbeat?: () => Promise<void> } = {}) {
  const recovery = await recoverStaleHistoryImportJobs();
  const jobs = await prisma.scheduledJob.findMany({ where: { type: ENERGY_HISTORY_CHUNK_JOB, status: JobStatus.PENDING, runAt: { lte: new Date() } }, orderBy: { runAt: "asc" }, take: Math.min(3, Math.max(1, options.limit ?? 1)) });
  let succeeded = 0;
  let failed = 0;
  for (const job of jobs) {
    await options.onHeartbeat?.();
    const payload = payloadSchema.safeParse(job.payload);
    if (!payload.success) { await prisma.scheduledJob.update({ where: { id: job.id }, data: { status: "FAILED", lastError: "HISTORY_JOB_PAYLOAD_INVALID", completedAt: new Date() } }); failed += 1; continue; }
    const owner = `history:${randomUUID()}`;
    const claimed = await prisma.scheduledJob.updateMany({ where: { id: job.id, status: "PENDING" }, data: { status: "RUNNING", attempts: { increment: 1 }, lockedAt: new Date(), lastError: owner } });
    if (!claimed.count) continue;
    const chunk = await prisma.energyHistoryImportChunk.update({ where: { id: payload.data.chunkId }, data: { status: "RUNNING", attempts: { increment: 1 }, startedAt: new Date() } });
    await prisma.energyHistoryImport.updateMany({ where: { id: chunk.importId, status: "QUEUED" }, data: { status: "RUNNING", startedAt: new Date() } });
    try {
      await importChunk(chunk.id);
      await prisma.scheduledJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", completedAt: new Date(), lockedAt: null, lastError: null } });
      succeeded += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1_000) : "HISTORY_IMPORT_FAILED";
      const retry = chunk.attempts < chunk.maxAttempts;
      await prisma.$transaction([
        prisma.energyHistoryImportChunk.update({ where: { id: chunk.id }, data: { status: retry ? "PENDING" : "FAILED", lastError: message, ...(retry ? {} : { completedAt: new Date() }) } }),
        prisma.scheduledJob.update({ where: { id: job.id }, data: retry ? { status: "PENDING", runAt: new Date(Date.now() + 2 ** chunk.attempts * 60_000), lockedAt: null, lastError: message } : { status: "FAILED", completedAt: new Date(), lockedAt: null, lastError: message } }),
      ]);
      await refreshRun(chunk.importId);
      failed += retry ? 0 : 1;
    }
  }
  return { processed: jobs.length, succeeded, failed, recovery };
}

export async function latestHistoryImport(userId: number, siteId: number) {
  const site = await prisma.energySite.findFirst({ where: { id: siteId, userId }, select: { id: true } });
  if (!site) throw new EnergyError("SITE_NOT_FOUND", "Elektrárna nebyla nalezena.", 404);
  return prisma.energyHistoryImport.findFirst({ where: { energySiteId: siteId }, orderBy: { createdAt: "desc" } });
}

const SPARSE_REQUEUE_MIN_AGE_MS = 24 * 60 * 60_000;
// A plant someone looked at recently is retried every hour; after five days
// without a visit the daily cadence returns, and after thirty days nothing
// retries until the next visit. The user asked for exactly that shape:
// fill the data while it matters, do not hammer the cloud for a plant no one
// looks at.
const RECENT_VIEW_MS = 5 * 86_400_000;
const STALE_VIEW_MS = 30 * 86_400_000;
const ACTIVE_RETRY_MIN_AGE_MS = 60 * 60_000;
// Mirrors the 75% coverage threshold `readyForEstimate` requires in data-quality.
const SPARSE_REQUEUE_COVERAGE_PERCENT = 75;
const SPARSE_REQUEUE_LIMIT = 3;
const SPARSE_REQUEUE_SCAN_LIMIT = 10;

export function historyRetryMinAgeMs(now: Date, lastViewedAt: Date | null) {
  if (!lastViewedAt) return SPARSE_REQUEUE_MIN_AGE_MS;
  const sinceView = now.getTime() - lastViewedAt.getTime();
  if (sinceView <= RECENT_VIEW_MS) return ACTIVE_RETRY_MIN_AGE_MS;
  if (sinceView <= STALE_VIEW_MS) return SPARSE_REQUEUE_MIN_AGE_MS;
  return Number.POSITIVE_INFINITY;
}

export function shouldRequeueSparseHistoryImport(input: {
  now: Date;
  latestImportCreatedAt: Date;
  batchStatuses: string[];
  coveragePercent: number;
  coverageDays: number;
  lastViewedAt?: Date | null;
}) {
  return (
    input.now.getTime() - input.latestImportCreatedAt.getTime() >= historyRetryMinAgeMs(input.now, input.lastViewedAt ?? null) &&
    input.batchStatuses.length > 0 &&
    // CANCELED is deliberately not requeued: someone stopped that batch.
    input.batchStatuses.every((status) => ["COMPLETED", "PARTIAL", "FAILED"].includes(status)) &&
    input.coverageDays >= 1 &&
    input.coveragePercent < SPARSE_REQUEUE_COVERAGE_PERCENT
  );
}

/**
 * The backend keeps backfilling its own SolaX store for days after a plant
 * connects, so an import that finished sparse can succeed later. Re-request it
 * daily instead of waiting for the user to trigger it by hand.
 */
export async function requeueSparseHistoryImports(now = new Date()) {
  const staleBefore = new Date(now.getTime() - ACTIVE_RETRY_MIN_AGE_MS);
  const sites = await prisma.energySite.findMany({
    where: {
      provider: EnergyProvider.LEGACY_SPOTTEX,
      historyImports: {
        some: {},
        none: { OR: [{ status: { in: ["QUEUED", "RUNNING"] } }, { createdAt: { gt: staleBefore } }] },
      },
    },
    select: { id: true, userId: true, metadata: true },
    orderBy: { id: "asc" },
    take: SPARSE_REQUEUE_SCAN_LIMIT,
  });
  let checked = 0;
  let requeued = 0;
  for (const site of sites) {
    if (requeued >= SPARSE_REQUEUE_LIMIT) break;
    checked += 1;
    try {
      const latest = await prisma.energyHistoryImport.findFirst({
        where: { energySiteId: site.id },
        orderBy: { createdAt: "desc" },
        select: { requestedFrom: true, requestedTo: true, createdAt: true },
      });
      if (!latest) continue;
      // The cloud has nothing more for this site; scheduled retries stop.
      if (siteHistoryClosure(site.metadata)) continue;
      const batch = await prisma.energyHistoryImport.findMany({
        where: { energySiteId: site.id, requestedFrom: latest.requestedFrom, requestedTo: latest.requestedTo },
        select: { status: true },
      });
      const quality = await getEnergyDataQuality(site.userId, site.id);
      const eligible = shouldRequeueSparseHistoryImport({
        now,
        latestImportCreatedAt: latest.createdAt,
        batchStatuses: batch.map((item) => item.status),
        coveragePercent: quality.coveragePercent,
        coverageDays: quality.coverageDays,
        lastViewedAt: siteLastViewedAt(site.metadata),
      });
      if (!eligible) continue;
      try {
        // Best effort: the backend backfill must never stop the platform's own import.
        await requestBackendHistoryBackfill(site.userId, site.id, "SCHEDULE");
      } catch {
        /* reported through the audit log when it runs, ignored here */
      }
      await requestHistoryImport(site.userId, site.id);
      requeued += 1;
    } catch {
      // One site's failed check or requeue must not block the remaining sites.
    }
  }
  return { checked, requeued };
}

function siteLastViewedAt(metadata: unknown): Date | null {
  const value = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>).lastViewedAt : null;
  const parsed = typeof value === "string" ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed : null;
}

/** Remembers that the owner looked at the plant, which drives the retry cadence. */
export async function markSiteViewed(userId: number, siteId: number, now = new Date()) {
  const site = await prisma.energySite.findFirst({ where: { id: siteId, userId }, select: { id: true, metadata: true } });
  if (!site) return;
  const metadata = site.metadata && typeof site.metadata === "object" && !Array.isArray(site.metadata) ? (site.metadata as Record<string, unknown>) : {};
  await prisma.energySite.update({ where: { id: site.id }, data: { metadata: { ...metadata, lastViewedAt: now.toISOString() } } });
}

/**
 * Asks the legacy backend to download the windows its SolaX history never
 * filled. Best effort: the backend may be unreachable or the process may lack
 * the legacy credentials, and neither must stop the platform's own import.
 */
export async function requestBackendHistoryBackfill(userId: number, siteId: number, trigger: "VISIT" | "SCHEDULE" | "MANUAL", now = new Date()) {
  const site = await prisma.energySite.findFirst({ where: { id: siteId, userId, provider: EnergyProvider.LEGACY_SPOTTEX }, include: { inverters: { orderBy: { id: "asc" } } } });
  if (!site || !LegacySpottexClient.isConfigured()) return { requested: 0, closed: false, results: [] as Array<{ inverterId: number; status: string }> };
  const connection = await prisma.energyConnection.findUnique({ where: { userId_provider: { userId, provider: EnergyProvider.LEGACY_SPOTTEX } } });
  if (!connection?.encryptedAccessToken || !connection.encryptedRefreshToken) return { requested: 0, closed: false, results: [] };
  const before = { accessToken: decryptSecret(connection.encryptedAccessToken), refreshToken: decryptSecret(connection.encryptedRefreshToken) };
  const client = new LegacySpottexClient({ tokens: before });
  const results: Array<{ inverterId: number; status: string }> = [];
  const unavailable: HistoryUnavailableWindow[] = [];
  for (const inverter of site.inverters) {
    try {
      const result = await client.requestHistoryBackfill(inverter.externalDeviceId);
      results.push({ inverterId: inverter.id, status: result.status });
      unavailable.push(...result.unavailable.map((item) => ({ ...item, inverterId: inverter.id })));
    } catch (error) {
      results.push({ inverterId: inverter.id, status: error instanceof Error ? error.message.slice(0, 120) : "FAILED" });
    }
  }
  const after = client.getTokens();
  if (after && (after.accessToken !== before.accessToken || after.refreshToken !== before.refreshToken)) {
    await prisma.energyConnection.update({ where: { id: connection.id }, data: { encryptedAccessToken: encryptSecret(after.accessToken), encryptedRefreshToken: encryptSecret(after.refreshToken), tokenExpiresAt: accessTokenExpiresAt(after.accessToken) } });
  }
  // "complete" from every inverter means nothing inside the download horizon
  // is missing except what the cloud already answered empty: the history is
  // closed and no further automatic attempts are worth making. Anything else
  // (queued, running, an error) keeps it open.
  const closed = results.length > 0 && results.every((item) => item.status === "complete");
  const metadata = site.metadata && typeof site.metadata === "object" && !Array.isArray(site.metadata) ? (site.metadata as Record<string, unknown>) : {};
  await prisma.energySite.update({
    where: { id: site.id },
    data: {
      metadata: {
        ...metadata,
        historyClosedAt: closed ? now.toISOString() : null,
        historyUnavailable: unavailable.slice(0, 200) as unknown as Prisma.InputJsonValue,
      },
    },
  });
  await prisma.auditLog.create({ data: { actorUserId: userId, action: "ENERGY_HISTORY_BACKFILL_REQUESTED", entityType: "EnergySite", entityId: String(site.id), metadata: { trigger, results, closed, unavailableWindows: unavailable.length } } });
  return { requested: results.filter((item) => item.status === "queued").length, closed, results };
}

export type HistoryUnavailableWindow = { from: string; to: string; reason: string; inverterId?: number };

/** What the backend recorded as closed for this site, if anything. */
export function siteHistoryClosure(metadata: unknown): { closedAt: Date; unavailable: HistoryUnavailableWindow[] } | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const record = metadata as Record<string, unknown>;
  if (typeof record.historyClosedAt !== "string") return null;
  const closedAt = new Date(record.historyClosedAt);
  if (Number.isNaN(closedAt.getTime())) return null;
  const unavailable = Array.isArray(record.historyUnavailable)
    ? record.historyUnavailable
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .filter((item) => typeof item.from === "string" && typeof item.to === "string")
        .map((item) => ({ from: String(item.from), to: String(item.to), reason: typeof item.reason === "string" ? item.reason : "cloud_empty" }))
    : [];
  return { closedAt, unavailable };
}

/**
 * What a visit does about sparse history: nothing while an import runs or
 * one finished less than an hour ago, otherwise ask the backend to backfill
 * its gaps and import again. Returns what happened so the page can say it.
 */
export async function refreshSiteHistoryIfSparse(userId: number, siteId: number, trigger: "VISIT" | "SCHEDULE" | "MANUAL", now = new Date()) {
  const site = await prisma.energySite.findFirst({ where: { id: siteId, userId, provider: EnergyProvider.LEGACY_SPOTTEX }, select: { id: true, metadata: true } });
  if (!site) return { status: "NOT_APPLICABLE" as const };
  const quality = await getEnergyDataQuality(userId, siteId);
  if (quality.coverageDays >= 1 && quality.coveragePercent >= SPARSE_REQUEUE_COVERAGE_PERCENT) return { status: "COMPLETE" as const };
  // Closed: the cloud has nothing more. Only an explicit request checks again.
  if (trigger !== "MANUAL" && siteHistoryClosure(site.metadata)) return { status: "CLOSED" as const };
  const latest = await prisma.energyHistoryImport.findFirst({ where: { energySiteId: siteId }, orderBy: { createdAt: "desc" }, select: { status: true, createdAt: true } });
  if (latest && ["QUEUED", "RUNNING"].includes(latest.status)) return { status: "RUNNING" as const };
  if (latest && trigger !== "MANUAL" && now.getTime() - latest.createdAt.getTime() < ACTIVE_RETRY_MIN_AGE_MS) return { status: "RECENT" as const };
  let backfillRequested = 0;
  let closed = false;
  try {
    const backfill = await requestBackendHistoryBackfill(userId, siteId, trigger, now);
    backfillRequested = backfill.requested;
    closed = backfill.closed;
  } catch {
    /* best effort */
  }
  // Even a closed site imports once more, so whatever the backend already
  // holds reaches the platform before the retries stop.
  await requestHistoryImport(userId, siteId);
  return { status: "REQUESTED" as const, backfillRequested, closed };
}

