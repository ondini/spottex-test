import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";

import { ENERGY_HISTORY_CHUNK_JOB, recoverStaleHistoryImportJobs, retryHistoryImport } from "./history-import";

vi.mock("server-only", () => ({}));

const databaseDescribe = process.env.RUN_DB_INTEGRATION_TESTS === "true" ? describe : describe.skip;

databaseDescribe("history import crash recovery", () => {
  afterAll(async () => prisma.$disconnect());

  it("recovers an interrupted chunk and lets an administrator restart only failed chunks", async () => {
    const suffix = randomUUID();
    const user = await prisma.user.create({ data: { email: `history-${suffix}@example.test`, passwordHash: "not-a-login-password", role: "ADMIN", status: "ACTIVE", emailVerifiedAt: new Date() } });
    const site = await prisma.energySite.create({ data: { userId: user.id, provider: "LEGACY_SPOTTEX", externalSiteId: `history-${suffix}`, name: "History recovery test", optimizationOn: true } });
    const inverter = await prisma.inverter.create({ data: { energySiteId: site.id, provider: "LEGACY_SPOTTEX", externalDeviceId: `history-${suffix}` } });
    const now = new Date();
    const run = await prisma.energyHistoryImport.create({ data: { energySiteId: site.id, inverterId: inverter.id, requestedFrom: new Date(now.getTime() - 86_400_000), requestedTo: now, status: "RUNNING", totalChunks: 1, startedAt: new Date(now.getTime() - 3_600_000) } });
    const chunk = await prisma.energyHistoryImportChunk.create({ data: { importId: run.id, chunkFrom: run.requestedFrom, chunkTo: run.requestedTo, status: "RUNNING", attempts: 1, startedAt: new Date(now.getTime() - 3_600_000) } });
    const job = await prisma.scheduledJob.create({ data: { type: ENERGY_HISTORY_CHUNK_JOB, idempotencyKey: `energy-history:${chunk.id}`, payload: { version: 1, chunkId: chunk.id }, status: "RUNNING", runAt: new Date(now.getTime() - 3_600_000), lockedAt: new Date(now.getTime() - 31 * 60_000), attempts: 1 } });
    try {
      await expect(recoverStaleHistoryImportJobs(now, [job.id])).resolves.toEqual({ scanned: 1, recovered: 1, failed: 0 });
      await expect(prisma.energyHistoryImportChunk.findUniqueOrThrow({ where: { id: chunk.id } })).resolves.toMatchObject({ status: "PENDING", attempts: 1 });
      await expect(prisma.scheduledJob.findUniqueOrThrow({ where: { id: job.id } })).resolves.toMatchObject({ status: "PENDING", lockedAt: null });
      await expect(prisma.energySite.findUniqueOrThrow({ where: { id: site.id } })).resolves.toMatchObject({ optimizationOn: true });

      await prisma.$transaction([
        prisma.energyHistoryImportChunk.update({ where: { id: chunk.id }, data: { status: "FAILED", lastError: "provider unavailable", completedAt: now } }),
        prisma.scheduledJob.update({ where: { id: job.id }, data: { status: "FAILED", lastError: "provider unavailable", completedAt: now } }),
      ]);
      await expect(retryHistoryImport(user.id, run.id)).resolves.toMatchObject({ status: "QUEUED", failedChunks: 0 });
      await expect(prisma.energyHistoryImportChunk.findUniqueOrThrow({ where: { id: chunk.id } })).resolves.toMatchObject({ status: "PENDING", attempts: 0, lastError: null });
      await expect(prisma.auditLog.count({ where: { actorUserId: user.id, action: "ENERGY_HISTORY_IMPORT_RETRIED", entityId: run.id } })).resolves.toBe(1);
    } finally {
      await prisma.scheduledJob.deleteMany({ where: { id: job.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
