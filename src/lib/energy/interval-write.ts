import "server-only";

import type { EnergyIntervalKind, Prisma } from "@prisma/client";

type MeasuredIntervalInput = {
  inverterId: number;
  kind: EnergyIntervalKind;
  startAt: Date;
  endAt: Date;
  kwh: number;
  predicted: boolean;
  correctionReason: string;
  sourceReference?: string | null;
  forecastGeneratedAt?: Date;
  forecastModelVersion?: string;
  forecastSource?: string;
};

export async function upsertMeasuredInterval(tx: Prisma.TransactionClient, input: MeasuredIntervalInput) {
  await persistForecastEvidence(tx, input);
  const key = { inverterId: input.inverterId, kind: input.kind, startAt: input.startAt };
  const existing = await tx.energyInterval.findUnique({ where: { inverterId_kind_startAt: key } });
  if (!existing) {
    return tx.energyInterval.create({
      data: { inverterId: input.inverterId, kind: input.kind, startAt: input.startAt, endAt: input.endAt, kwh: input.kwh, predicted: input.predicted },
    });
  }
  const changed = existing.endAt.getTime() !== input.endAt.getTime()
    || Math.abs(existing.kwh - input.kwh) > 1e-9
    || existing.predicted !== input.predicted;
  if (!changed) return existing;
  await tx.energyIntervalCorrection.create({
    data: {
      intervalId: existing.id,
      originalEndAt: existing.endAt,
      originalKwh: existing.kwh,
      originalPredicted: existing.predicted,
      correctedEndAt: input.endAt,
      correctedKwh: input.kwh,
      correctedPredicted: input.predicted,
      reason: input.correctionReason,
      sourceReference: input.sourceReference ?? null,
    },
  });
  return tx.energyInterval.update({
    where: { id: existing.id },
    data: { endAt: input.endAt, kwh: input.kwh, predicted: input.predicted },
  });
}

export async function upsertMeasuredIntervalsBulk(
  tx: Prisma.TransactionClient,
  inputs: MeasuredIntervalInput[],
) {
  if (!inputs.length) return;
  for (const input of inputs) await persistForecastEvidence(tx, input);
  const inverterId = inputs[0].inverterId;
  if (inputs.some((input) => input.inverterId !== inverterId)) {
    throw new Error("BULK_INTERVALS_REQUIRE_ONE_INVERTER");
  }
  const from = new Date(Math.min(...inputs.map((input) => input.startAt.getTime())));
  const to = new Date(Math.max(...inputs.map((input) => input.startAt.getTime())));
  const existing = await tx.energyInterval.findMany({
    where: {
      inverterId,
      kind: { in: [...new Set(inputs.map((input) => input.kind))] },
      startAt: { gte: from, lte: to },
    },
  });
  const key = (kind: EnergyIntervalKind, startAt: Date) => `${kind}:${startAt.toISOString()}`;
  const existingByKey = new Map(existing.map((row) => [key(row.kind, row.startAt), row]));
  const missing = inputs.filter((input) => !existingByKey.has(key(input.kind, input.startAt)));
  if (missing.length) {
    await tx.energyInterval.createMany({
      data: missing.map((input) => ({
        inverterId: input.inverterId,
        kind: input.kind,
        startAt: input.startAt,
        endAt: input.endAt,
        kwh: input.kwh,
        predicted: input.predicted,
      })),
      skipDuplicates: true,
    });
  }

  const changed = inputs.flatMap((input) => {
    const row = existingByKey.get(key(input.kind, input.startAt));
    if (!row) return [];
    return row.endAt.getTime() !== input.endAt.getTime()
      || Math.abs(row.kwh - input.kwh) > 1e-9
      || row.predicted !== input.predicted
      ? [{ row, input }]
      : [];
  });
  if (changed.length) {
    await tx.energyIntervalCorrection.createMany({
      data: changed.map(({ row, input }) => ({
        intervalId: row.id,
        originalEndAt: row.endAt,
        originalKwh: row.kwh,
        originalPredicted: row.predicted,
        correctedEndAt: input.endAt,
        correctedKwh: input.kwh,
        correctedPredicted: input.predicted,
        reason: input.correctionReason,
        sourceReference: input.sourceReference ?? null,
      })),
    });
    for (const { row, input } of changed) {
      await tx.energyInterval.update({
        where: { id: row.id },
        data: { endAt: input.endAt, kwh: input.kwh, predicted: input.predicted },
      });
    }
  }
}

async function persistForecastEvidence(
  tx: Prisma.TransactionClient,
  input: MeasuredIntervalInput,
) {
  const forecastKind =
    input.kind === "PRODUCTION" || input.kind === "CONSUMPTION";
  if (
    input.predicted &&
    forecastKind &&
    input.forecastGeneratedAt &&
    input.startAt >= input.forecastGeneratedAt
  ) {
    await tx.energyForecastSnapshot.createMany({
      data: [{
        inverterId: input.inverterId,
        kind: input.kind,
        generatedAt: input.forecastGeneratedAt,
        targetStartAt: input.startAt,
        targetEndAt: input.endAt,
        horizonMinutes: Math.max(
          0,
          Math.round(
            (input.startAt.getTime() - input.forecastGeneratedAt.getTime()) /
              60_000,
          ),
        ),
        predictedKwh: input.kwh,
        modelVersion: input.forecastModelVersion || "LEGACY_UNVERSIONED",
        source: input.forecastSource || "LEGACY_SPOTTEX",
      }],
      skipDuplicates: true,
    });
  }
  if (!input.predicted && forecastKind) {
    await tx.energyForecastSnapshot.updateMany({
      where: {
        inverterId: input.inverterId,
        kind: input.kind,
        targetStartAt: input.startAt,
        actualKwh: null,
      },
      data: {
        actualKwh: input.kwh,
        actualObservedAt: new Date(),
      },
    });
  }
}
