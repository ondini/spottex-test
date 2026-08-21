import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it, vi } from "vitest";

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

import {
  ENERGY_HISTORY_CHUNK_JOB,
  fetchHistoryWithDurableTokens,
  recoverStaleHistoryImportJobs,
  retryHistoryImport,
} from "./history-import";

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

  it("persists a rotated token pair even when the history request still fails", async () => {
    const suffix = randomUUID();
    const previousEncryptionKey = process.env.APP_ENCRYPTION_KEY;
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const oldTokens = { accessToken: "old-access", refreshToken: "old-refresh" };
    const newTokens = {
      accessToken: `header.${Buffer.from(JSON.stringify({ exp: 2_000_000_000 })).toString("base64url")}.signature`,
      refreshToken: "new-refresh",
    };
    let userId: number | null = null;

    try {
      const user = await prisma.user.create({ data: { email: `history-token-${suffix}@example.test`, passwordHash: "not-a-login-password", role: "USER", status: "ACTIVE", emailVerifiedAt: new Date() } });
      userId = user.id;
      const connection = await prisma.energyConnection.create({
        data: {
          userId: user.id,
          provider: "LEGACY_SPOTTEX",
          encryptedAccessToken: encryptSecret(oldTokens.accessToken),
          encryptedRefreshToken: encryptSecret(oldTokens.refreshToken),
        },
      });
      const client = {
        fetchHistoricalIntervals: vi.fn().mockRejectedValue(new Error("history cache pending")),
        getTokens: vi.fn().mockReturnValue(newTokens),
      };
      await expect(
        fetchHistoryWithDurableTokens(
          connection,
          oldTokens,
          client,
          "device-1",
          new Date("2026-01-01T00:00:00.000Z"),
          new Date("2026-01-02T00:00:00.000Z"),
        ),
      ).rejects.toThrow("history cache pending");
      const stored = await prisma.energyConnection.findUniqueOrThrow({ where: { id: connection.id } });
      expect(decryptSecret(stored.encryptedAccessToken!)).toBe(newTokens.accessToken);
      expect(decryptSecret(stored.encryptedRefreshToken!)).toBe(newTokens.refreshToken);
      expect(stored.tokenExpiresAt?.toISOString()).toBe("2033-05-18T03:33:20.000Z");
    } finally {
      if (userId !== null) await prisma.user.delete({ where: { id: userId } });
      if (previousEncryptionKey === undefined) delete process.env.APP_ENCRYPTION_KEY;
      else process.env.APP_ENCRYPTION_KEY = previousEncryptionKey;
    }
  });
});
