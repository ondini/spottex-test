import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { JobStatus, Prisma, ScheduledJob } from "@prisma/client";
import { z } from "zod";

import { hasInverterControlEntitlement } from "@/lib/commerce/entitlement";
import { prisma } from "@/lib/prisma";

import { deactivateInverterControl } from "./service";

export const INVERTER_DEACTIVATION_JOB = "ENERGY_INVERTER_DEACTIVATION";

const STALE_LOCK_MS = 10 * 60_000;
const payloadSchema = z.object({
  version: z.literal(1),
  userId: z.number().int().positive(),
  reason: z.string().min(1).max(300),
}).strict();

type JobClient = Pick<Prisma.TransactionClient, "scheduledJob">;

export type EnqueueInverterDeactivationInput = {
  userId: number;
  reason: string;
  /**
   * Stable, event-specific key, for example `subscription-cancel:${id}` or
   * `payment-refund:${paymentId}`. It is hashed before persistence so caller
   * data cannot leak through the globally unique ScheduledJob key.
   */
  idempotencyKey: string;
  runAt?: Date;
};

export async function enqueueInverterDeactivationJob(
  tx: JobClient,
  input: EnqueueInverterDeactivationInput,
) {
  if (!Number.isInteger(input.userId) || input.userId <= 0) {
    throw new Error("Neplatný uživatel deaktivační úlohy.");
  }
  const reason = input.reason.trim().slice(0, 300);
  if (!reason) throw new Error("Deaktivační úloha musí mít důvod.");
  if (!input.idempotencyKey.trim()) throw new Error("Deaktivační úloha musí mít idempotency klíč.");
  const digest = createHash("sha256")
    .update(`${input.userId}\u0000${input.idempotencyKey}`)
    .digest("hex");
  const idempotencyKey = `energy-deactivation:${input.userId}:${digest}`;
  return tx.scheduledJob.upsert({
    where: { idempotencyKey },
    update: {},
    create: {
      type: INVERTER_DEACTIVATION_JOB,
      idempotencyKey,
      payload: { version: 1, userId: input.userId, reason },
      runAt: input.runAt ?? new Date(),
    },
  });
}

function retryDelayMs(attempt: number): number {
  const exponent = Math.min(10, Math.max(0, attempt - 1));
  return Math.min(6 * 60 * 60_000, 30_000 * (2 ** exponent));
}

async function heartbeatJob(jobId: string, owner: string) {
  const heartbeat = await prisma.scheduledJob.updateMany({
    where: {
      id: jobId,
      type: INVERTER_DEACTIVATION_JOB,
      status: JobStatus.RUNNING,
      lastError: owner,
    },
    data: { lockedAt: new Date() },
  });
  if (!heartbeat.count) throw new Error("INVERTER_DEACTIVATION_JOB_CLAIM_LOST");
}

async function executeDeactivationJob(
  job: Pick<ScheduledJob, "id" | "payload">,
  owner: string,
  attempt: number,
  onHeartbeat?: () => Promise<void>,
) {
  const payload = payloadSchema.parse(job.payload);
  const maintainClaims = async () => {
    await heartbeatJob(job.id, owner);
    await onHeartbeat?.();
  };
  await maintainClaims();

  // A cancellation/refund can race with a newly activated PROMO or paid
  // subscription. In that case the old deactivation event is obsolete.
  if (await hasInverterControlEntitlement(payload.userId)) {
    await prisma.auditLog.create({
      data: {
        actorUserId: payload.userId,
        action: "INVERTER_DEACTIVATION_SKIPPED_ENTITLED",
        entityType: "ScheduledJob",
        entityId: job.id,
        metadata: { reason: payload.reason },
      },
    });
    return { userId: payload.userId, noOp: true, attempted: 0, failed: 0 };
  }

  // Every claimed attempt gets a distinct physical OFF idempotency namespace.
  // Re-running the same ScheduledJob remains logically idempotent, while a
  // second entitlement-loss event (or a retry after remote drift) cannot reuse
  // an older ACK without contacting and verifying the provider again.
  const deactivation = await deactivateInverterControl(
    payload.userId,
    `${payload.reason}:job:${job.id}:attempt:${attempt}`,
    {
      onProgress: maintainClaims,
    },
  );
  await maintainClaims();
  if (deactivation.failed > 0) {
    throw new Error("INVERTER_PHYSICAL_DEACTIVATION_NOT_CONFIRMED");
  }
  return { userId: payload.userId, noOp: false, ...deactivation };
}

export type ProcessInverterDeactivationJobsOptions = {
  limit?: number;
  jobIds?: string[];
  now?: Date;
  onHeartbeat?: () => Promise<void>;
};

export async function processInverterDeactivationJobs(
  options: ProcessInverterDeactivationJobsOptions = {},
) {
  const now = options.now ?? new Date();
  const staleBefore = new Date(now.getTime() - STALE_LOCK_MS);
  const recovered = await prisma.scheduledJob.updateMany({
    where: {
      type: INVERTER_DEACTIVATION_JOB,
      status: JobStatus.RUNNING,
      lockedAt: { lt: staleBefore },
    },
    data: {
      status: JobStatus.PENDING,
      runAt: now,
      lockedAt: null,
      lastError: "Recovered after an interrupted inverter deactivation",
    },
  });

  const pending = await prisma.scheduledJob.findMany({
    where: {
      type: INVERTER_DEACTIVATION_JOB,
      status: JobStatus.PENDING,
      runAt: { lte: now },
      ...(options.jobIds ? { id: { in: options.jobIds } } : {}),
    },
    orderBy: [{ runAt: "asc" }, { createdAt: "asc" }],
    take: Math.min(10, Math.max(1, options.limit ?? 2)),
  });

  let processed = 0;
  let succeeded = 0;
  let retried = 0;
  let noOp = 0;
  const outcomes: Array<{
    jobId: string;
    userId: number | null;
    status: "SUCCEEDED" | "RETRIED";
    noOp?: boolean;
    attempted?: number;
    failed?: number;
  }> = [];

  for (const job of pending) {
    await options.onHeartbeat?.();
    const owner = `energy-job:${randomUUID()}`;
    const claimed = await prisma.scheduledJob.updateMany({
      where: { id: job.id, status: JobStatus.PENDING },
      data: {
        status: JobStatus.RUNNING,
        lockedAt: new Date(),
        attempts: { increment: 1 },
        completedAt: null,
        lastError: owner,
      },
    });
    if (!claimed.count) continue;
    processed += 1;
    const attempt = job.attempts + 1;
    let userId: number | null = null;
    try {
      const result = await executeDeactivationJob(job, owner, attempt, options.onHeartbeat);
      userId = result.userId;
      const completed = await prisma.scheduledJob.updateMany({
        where: {
          id: job.id,
          status: JobStatus.RUNNING,
          lastError: owner,
        },
        data: {
          status: JobStatus.SUCCEEDED,
          lockedAt: null,
          completedAt: new Date(),
          lastError: null,
        },
      });
      if (!completed.count) throw new Error("INVERTER_DEACTIVATION_JOB_CLAIM_LOST");
      succeeded += 1;
      if (result.noOp) noOp += 1;
      outcomes.push({
        jobId: job.id,
        userId,
        status: "SUCCEEDED",
        noOp: result.noOp,
        attempted: result.attempted,
        failed: result.failed,
      });
    } catch (error) {
      const claimLost = error instanceof Error && error.message === "INVERTER_DEACTIVATION_JOB_CLAIM_LOST";
      const payload = payloadSchema.safeParse(job.payload);
      userId = payload.success ? payload.data.userId : null;
      const rescheduled = claimLost ? { count: 0 } : await prisma.scheduledJob.updateMany({
        where: {
          id: job.id,
          status: JobStatus.RUNNING,
          lastError: owner,
        },
        data: {
          status: JobStatus.PENDING,
          runAt: new Date(now.getTime() + retryDelayMs(attempt)),
          lockedAt: null,
          lastError: "Physical inverter deactivation is not yet confirmed",
        },
      });
      if (rescheduled.count) {
        retried += 1;
        outcomes.push({ jobId: job.id, userId, status: "RETRIED" });
      }
    }
    await options.onHeartbeat?.();
  }

  return {
    recovered: recovered.count,
    selected: pending.length,
    processed,
    succeeded,
    retried,
    noOp,
    outcomes,
  };
}
