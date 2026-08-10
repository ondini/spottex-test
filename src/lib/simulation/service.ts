import "server-only";

import { randomUUID } from "node:crypto";

import { EnergyIntervalKind, JobStatus, Prisma, ScheduledJob } from "@prisma/client";
import { z } from "zod";

import { queueEmail } from "@/lib/email";
import { getEnergyDataQuality } from "@/lib/energy/data-quality";
import { prisma } from "@/lib/prisma";

import { runSimulation } from "./engine";
import type { SimulationInput, SimulationJobView, SimulationPoint, SimulationResult } from "./types";

export const ENERGY_SIMULATION_JOB = "ENERGY_SAVINGS_SIMULATION";

export const simulationInputSchema = z.object({
  siteId: z.number().int().positive(),
  currentBatteryKwh: z.number().min(0).max(5_000),
  currentPvKwp: z.number().min(0.5).max(10_000),
  batteryPriceCzkPerKwh: z.number().min(0).max(200_000).default(15_000),
  pvPriceCzkPerKwp: z.number().min(0).max(200_000).default(25_000),
  exportPriceCzkPerKwh: z.number().min(-10).max(50).default(0.5),
}).strict();

const payloadSchema = z.object({
  version: z.literal(1),
  userId: z.number().int().positive(),
  input: simulationInputSchema,
  stage: z.string(),
  result: z.unknown().optional(),
}).strict();

type SimulationPayload = z.infer<typeof payloadSchema>;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function number(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeFailure(error: unknown): string {
  if (error instanceof Error && error.message === "SIMULATION_DATA_INSUFFICIENT") {
    return "Pro výpočet zatím nemáme dost společných intervalů výroby a spotřeby. Nechte synchronizaci pokračovat a zkuste to znovu.";
  }
  return "Výpočet se nepodařilo dokončit. Vstupy zůstaly uložené a můžete jej spustit znovu.";
}

function view(job: ScheduledJob): SimulationJobView | null {
  const payload = payloadSchema.safeParse(job.payload);
  if (!payload.success) return null;
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
    stage: payload.data.stage,
    error: job.status === JobStatus.FAILED ? job.lastError : null,
    input: payload.data.input,
    result:
      job.status === JobStatus.SUCCEEDED && payload.data.result
        ? (payload.data.result as SimulationResult)
        : null,
  };
}

export async function getSimulationWorkspace(userId: number) {
  const [sites, jobs] = await Promise.all([
    prisma.energySite.findMany({
      where: { userId, inverters: { some: {} } },
      orderBy: { id: "asc" },
      select: { id: true, name: true, provider: true, lastSyncedAt: true, metadata: true },
    }),
    prisma.scheduledJob.findMany({
      where: {
        type: ENERGY_SIMULATION_JOB,
        payload: { path: ["userId"], equals: userId },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  const quality = new Map(await Promise.all(sites.map(async (site) => [
    site.id,
    await getEnergyDataQuality(userId, site.id),
  ] as const)));
  return {
    sites: sites.map((site) => {
      const metadata = record(site.metadata);
      return {
        id: site.id,
        name: site.name,
        provider: site.provider,
        lastSyncedAt: site.lastSyncedAt?.toISOString() ?? null,
        currentBatteryKwh: number(metadata.batteryCapacityKwh, site.provider === "DEMO" ? 11.6 : 0),
        currentPvKwp: number(metadata.pvCapacityKwp, site.provider === "DEMO" ? 9.9 : 0),
        dataQuality: quality.get(site.id)!,
      };
    }),
    jobs: jobs.map(view).filter((job): job is SimulationJobView => job !== null),
  };
}

export async function enqueueSimulation(userId: number, rawInput: unknown) {
  const input = simulationInputSchema.parse(rawInput);
  const site = await prisma.energySite.findFirst({
    where: { id: input.siteId, userId, inverters: { some: {} } },
    select: { id: true },
  });
  if (!site) throw new Error("SIMULATION_SITE_NOT_FOUND");
  const quality = await getEnergyDataQuality(userId, site.id);
  if (!quality.readyForEstimate) throw new Error("SIMULATION_HISTORY_INSUFFICIENT");

  const payload: SimulationPayload = {
    version: 1,
    userId,
    input,
    stage: "Čeká na zpracování",
  };
  const job = await prisma.scheduledJob.create({
    data: {
      type: ENERGY_SIMULATION_JOB,
      idempotencyKey: `energy-simulation:${userId}:${randomUUID()}`,
      payload: payload as Prisma.InputJsonValue,
      runAt: new Date(),
    },
  });
  await prisma.auditLog.create({
    data: {
      actorUserId: userId,
      action: "ENERGY_SIMULATION_REQUESTED",
      entityType: "ScheduledJob",
      entityId: job.id,
      metadata: { siteId: input.siteId },
    },
  });
  return view(job);
}

async function loadPoints(userId: number, input: SimulationInput): Promise<SimulationPoint[]> {
  const site = await prisma.energySite.findFirst({
    where: { id: input.siteId, userId },
    include: { inverters: { orderBy: { id: "asc" }, take: 1 } },
  });
  const inverter = site?.inverters[0];
  if (!site || !inverter) throw new Error("SIMULATION_SITE_NOT_FOUND");

  const intervals = await prisma.energyInterval.findMany({
    where: {
      inverterId: inverter.id,
      kind: { in: [EnergyIntervalKind.PRODUCTION, EnergyIntervalKind.CONSUMPTION] },
      startAt: { gte: new Date(Date.now() - 366 * 24 * 60 * 60_000) },
      predicted: false,
    },
    orderBy: [{ startAt: "asc" }, { kind: "asc" }],
  });
  const merged = new Map<
    number,
    { at: Date; intervalHours: number; productionKwh?: number; consumptionKwh?: number }
  >();
  for (const interval of intervals) {
    const key = interval.startAt.getTime();
    const item = merged.get(key) ?? {
      at: interval.startAt,
      intervalHours: Math.min(1, Math.max(0.25, (interval.endAt.getTime() - key) / 3_600_000)),
    };
    if (interval.kind === EnergyIntervalKind.PRODUCTION) item.productionKwh = interval.kwh;
    if (interval.kind === EnergyIntervalKind.CONSUMPTION) item.consumptionKwh = interval.kwh;
    merged.set(key, item);
  }
  return [...merged.values()]
    .filter(
      (item): item is SimulationPoint =>
        item.productionKwh !== undefined && item.consumptionKwh !== undefined,
    )
    .map((item) => ({
      at: item.at,
      intervalHours: item.intervalHours,
      productionKwh: item.productionKwh,
      consumptionKwh: item.consumptionKwh,
    }));
}

async function execute(job: ScheduledJob, payload: SimulationPayload, owner: string) {
  const points = await loadPoints(payload.userId, payload.input);
  const result = runSimulation(payload.input, points);
  const completedPayload: SimulationPayload = { ...payload, stage: "Výpočet dokončen", result };
  await prisma.$transaction(async (tx) => {
    const completed = await tx.scheduledJob.updateMany({
      where: { id: job.id, status: JobStatus.RUNNING, lastError: owner },
      data: {
        status: JobStatus.SUCCEEDED,
        payload: completedPayload as Prisma.InputJsonValue,
        lockedAt: null,
        lastError: null,
        completedAt: new Date(),
      },
    });
    if (!completed.count) throw new Error("SIMULATION_JOB_CLAIM_LOST");
    await tx.auditLog.create({
      data: {
        actorUserId: payload.userId,
        action: "ENERGY_SIMULATION_COMPLETED",
        entityType: "ScheduledJob",
        entityId: job.id,
        metadata: {
          siteId: payload.input.siteId,
          scenarios: result.scenarios.length,
          confidence: result.data.confidence,
        },
      },
    });
  });

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { email: true, name: true },
  });
  if (user) {
    await queueEmail({
      idempotencyKey: `energy-simulation:${job.id}:completed`,
      to: user.email,
      subject: "Výpočet úspor Spottex je hotový",
      text: `Dobrý den${user.name ? ` ${user.name}` : ""},\n\nvaše analýza je dokončená. Výsledky najdete ve svém účtu:\n\n${process.env.APP_URL || "http://localhost:3004"}/app/analyza\n\nVýsledek je orientační a u sazeb je potřeba ověřit podmínky distributora.`,
    });
  }
  return result;
}

export async function processSimulationJobs(options: {
  limit?: number;
  onHeartbeat?: () => Promise<void>;
} = {}) {
  const now = new Date();
  await prisma.scheduledJob.updateMany({
    where: {
      type: ENERGY_SIMULATION_JOB,
      status: JobStatus.RUNNING,
      lockedAt: { lt: new Date(now.getTime() - 30 * 60_000) },
    },
    data: {
      status: JobStatus.PENDING,
      runAt: now,
      lockedAt: null,
      lastError: "Obnoveno po přerušeném výpočtu.",
    },
  });
  const pending = await prisma.scheduledJob.findMany({
    where: { type: ENERGY_SIMULATION_JOB, status: JobStatus.PENDING, runAt: { lte: now } },
    orderBy: [{ runAt: "asc" }, { createdAt: "asc" }],
    take: Math.min(5, Math.max(1, options.limit ?? 1)),
  });
  let succeeded = 0;
  let failed = 0;
  for (const job of pending) {
    await options.onHeartbeat?.();
    const payload = payloadSchema.safeParse(job.payload);
    if (!payload.success) {
      await prisma.scheduledJob.update({
        where: { id: job.id },
        data: { status: JobStatus.FAILED, lastError: "Neplatné zadání simulace.", completedAt: new Date() },
      });
      failed += 1;
      continue;
    }
    const owner = `simulation:${randomUUID()}`;
    const claimed = await prisma.scheduledJob.updateMany({
      where: { id: job.id, status: JobStatus.PENDING },
      data: {
        status: JobStatus.RUNNING,
        lockedAt: new Date(),
        attempts: { increment: 1 },
        lastError: owner,
        payload: { ...payload.data, stage: "Načítáme historická data a počítáme varianty" } as Prisma.InputJsonValue,
      },
    });
    if (!claimed.count) continue;
    try {
      await execute(job, payload.data, owner);
      succeeded += 1;
    } catch (error) {
      if (error instanceof Error && error.message === "SIMULATION_JOB_CLAIM_LOST") continue;
      await prisma.scheduledJob.updateMany({
        where: { id: job.id, status: JobStatus.RUNNING, lastError: owner },
        data: {
          status: JobStatus.FAILED,
          lockedAt: null,
          completedAt: new Date(),
          lastError: safeFailure(error),
          payload: { ...payload.data, stage: "Výpočet vyžaduje pozornost" } as Prisma.InputJsonValue,
        },
      });
      failed += 1;
    }
  }
  return { processed: succeeded + failed, succeeded, failed };
}
