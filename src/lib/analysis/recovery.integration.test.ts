import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { ENERGY_ANALYSIS_JOB, recoverStaleAnalysisJobs } from "./service";

describe("analysis worker recovery", () => {
  it("returns an interrupted run and its scenario to the queue", async () => {
    const suffix = randomUUID();
    const now = new Date();
    const user = await prisma.user.create({ data: { email: `analysis-recovery-${suffix}@example.test`, passwordHash: "not-used-by-test", status: "ACTIVE" } });
    const site = await prisma.energySite.create({ data: { userId: user.id, provider: "DEMO", externalSiteId: `analysis-recovery-${suffix}`, name: "Recovery" } });
    const run = await prisma.energyAnalysisRun.create({ data: { userId: user.id, energySiteId: site.id, status: "RUNNING", engineVersion: "TEST", methodologyVersion: "TEST", inputFingerprint: suffix, startedAt: new Date(now.getTime() - 2 * 60 * 60_000) } });
    const job = await prisma.scheduledJob.create({ data: { type: ENERGY_ANALYSIS_JOB, idempotencyKey: `energy-analysis:${run.id}`, payload: { version: 2, analysisRunId: run.id }, status: "RUNNING", runAt: now, lockedAt: new Date(now.getTime() - 2 * 60 * 60_000), attempts: 1 } });
    try {
      await expect(recoverStaleAnalysisJobs(now, [job.id])).resolves.toEqual({ scanned: 1, recovered: 1, failed: 0 });
      await expect(prisma.energyAnalysisRun.findUniqueOrThrow({ where: { id: run.id }, select: { status: true, errorCode: true } })).resolves.toEqual({ status: "QUEUED", errorCode: "ANALYSIS_WORKER_INTERRUPTED" });
      await expect(prisma.scheduledJob.findUniqueOrThrow({ where: { id: job.id }, select: { status: true, lockedAt: true } })).resolves.toEqual({ status: "PENDING", lockedAt: null });
    } finally {
      await prisma.scheduledJob.deleteMany({ where: { id: job.id } });
      await prisma.energyAnalysisRun.deleteMany({ where: { id: run.id } });
      await prisma.energySite.deleteMany({ where: { id: site.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
    }
  });
});
