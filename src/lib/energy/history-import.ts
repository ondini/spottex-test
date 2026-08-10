import "server-only";

import { randomUUID } from "node:crypto";

import { EnergyIntervalKind, EnergyProvider, JobStatus } from "@prisma/client";
import { z } from "zod";

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { supersedeSiteAnalyses } from "@/lib/analysis/invalidation";
import { prisma } from "@/lib/prisma";

import { invalidateEnergyDataQualityCache } from "./data-quality";
import { accessTokenExpiresAt, LegacySpottexClient } from "./legacy-client";
import { upsertMeasuredIntervalsBulk } from "./interval-write";
import { EnergyError } from "./types";

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

export function historyChunks(from: Date, to: Date, chunkMs = CHUNK_MS) {
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from || chunkMs <= 0) throw new Error("HISTORY_IMPORT_INVALID_WINDOW");
  const chunks: Array<{ from: Date; to: Date }> = [];
  for (let cursor = from.getTime(); cursor < to.getTime(); cursor += chunkMs) {
    chunks.push({ from: new Date(cursor), to: new Date(Math.min(to.getTime(), cursor + chunkMs)) });
  }
  return chunks;
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
  const values = responseSchema.parse(await client.fetchHistoricalIntervals(run.inverter.externalDeviceId, chunk.chunkFrom, chunk.chunkTo));
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
    const after = client.getTokens();
    if (after && (after.accessToken !== before.accessToken || after.refreshToken !== before.refreshToken)) {
      await tx.energyConnection.update({ where: { id: connection.id }, data: { encryptedAccessToken: encryptSecret(after.accessToken), encryptedRefreshToken: encryptSecret(after.refreshToken), tokenExpiresAt: accessTokenExpiresAt(after.accessToken) } });
    }
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
