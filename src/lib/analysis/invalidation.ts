import { Prisma } from "@prisma/client";

import { ENERGY_ANALYSIS_JOB } from "./service";

export async function supersedeSiteAnalyses(tx: Prisma.TransactionClient, input: {
  energySiteId: number;
  reason: string;
  actorUserId?: number;
}) {
  const runs = await tx.energyAnalysisRun.findMany({
    where: { energySiteId: input.energySiteId, status: { in: ["DRAFT", "WAITING_FOR_DATA", "QUEUED", "RUNNING", "COMPLETED"] } },
    select: { id: true },
  });
  if (!runs.length) return { superseded: 0, canceledJobs: 0 };
  const ids = runs.map((run) => run.id);
  const now = new Date();
  const [superseded, canceledJobs] = await Promise.all([
    tx.energyAnalysisRun.updateMany({
      where: { id: { in: ids }, status: { in: ["DRAFT", "WAITING_FOR_DATA", "QUEUED", "RUNNING", "COMPLETED"] } },
      data: { status: "SUPERSEDED", errorCode: "INPUTS_CHANGED", errorMessage: input.reason, completedAt: now },
    }),
    tx.scheduledJob.updateMany({
      where: { type: ENERGY_ANALYSIS_JOB, idempotencyKey: { in: ids.map((id) => `energy-analysis:${id}`) }, status: { in: ["PENDING", "RUNNING"] } },
      data: { status: "CANCELED", completedAt: now, lockedAt: null, lastError: "INPUTS_CHANGED" },
    }),
  ]);
  await tx.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: "ENERGY_ANALYSES_SUPERSEDED",
      entityType: "EnergySite",
      entityId: String(input.energySiteId),
      metadata: { reason: input.reason, runIds: ids, canceledJobs: canceledJobs.count },
    },
  });
  return { superseded: superseded.count, canceledJobs: canceledJobs.count };
}
