import { randomUUID } from "node:crypto";

import { EnergyIntervalKind } from "@prisma/client";
import { afterAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";

import { upsertMeasuredInterval } from "./interval-write";

vi.mock("server-only", () => ({}));

const databaseDescribe = process.env.RUN_DB_INTEGRATION_TESTS === "true" ? describe : describe.skip;

databaseDescribe("immutable energy interval corrections", () => {
  afterAll(async () => prisma.$disconnect());

  it("keeps the original value before a reimport changes an interval", async () => {
    const suffix = randomUUID();
    const user = await prisma.user.create({ data: { email: `interval-${suffix}@example.test`, passwordHash: "not-a-login-password", status: "ACTIVE", emailVerifiedAt: new Date() } });
    const site = await prisma.energySite.create({ data: { userId: user.id, provider: "DEMO", externalSiteId: `interval-${suffix}`, name: "Interval correction test" } });
    const inverter = await prisma.inverter.create({ data: { energySiteId: site.id, provider: "DEMO", externalDeviceId: `interval-${suffix}` } });
    const startAt = new Date("2026-01-01T00:00:00.000Z");
    const endAt = new Date("2026-01-01T00:15:00.000Z");
    try {
      await prisma.$transaction((tx) => upsertMeasuredInterval(tx, { inverterId: inverter.id, kind: EnergyIntervalKind.PRODUCTION, startAt, endAt, kwh: 1.2, predicted: false, correctionReason: "FIRST_IMPORT" }));
      await prisma.$transaction((tx) => upsertMeasuredInterval(tx, { inverterId: inverter.id, kind: EnergyIntervalKind.PRODUCTION, startAt, endAt, kwh: 1.35, predicted: false, correctionReason: "HISTORY_REIMPORT", sourceReference: "chunk-2" }));
      const interval = await prisma.energyInterval.findUniqueOrThrow({ where: { inverterId_kind_startAt: { inverterId: inverter.id, kind: EnergyIntervalKind.PRODUCTION, startAt } }, include: { corrections: true } });
      expect(interval.kwh).toBe(1.35);
      expect(interval.corrections).toHaveLength(1);
      expect(interval.corrections[0]).toMatchObject({ originalKwh: 1.2, correctedKwh: 1.35, reason: "HISTORY_REIMPORT", sourceReference: "chunk-2" });
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it("keeps an immutable forecast and attaches the later actual value", async () => {
    const suffix = randomUUID();
    const user = await prisma.user.create({ data: { email: `forecast-${suffix}@example.test`, passwordHash: "not-a-login-password", status: "ACTIVE", emailVerifiedAt: new Date() } });
    const site = await prisma.energySite.create({ data: { userId: user.id, provider: "DEMO", externalSiteId: `forecast-${suffix}`, name: "Forecast evidence test" } });
    const inverter = await prisma.inverter.create({ data: { energySiteId: site.id, provider: "DEMO", externalDeviceId: `forecast-${suffix}` } });
    const generatedAt = new Date("2026-01-01T00:00:00.000Z");
    const startAt = new Date("2026-01-01T03:00:00.000Z");
    const endAt = new Date("2026-01-01T03:15:00.000Z");
    try {
      await prisma.$transaction((tx) => upsertMeasuredInterval(tx, {
        inverterId: inverter.id,
        kind: EnergyIntervalKind.PRODUCTION,
        startAt,
        endAt,
        kwh: 1.2,
        predicted: true,
        correctionReason: "LIVE_SNAPSHOT_REFRESH",
        forecastGeneratedAt: generatedAt,
        forecastModelVersion: "test-v1",
        forecastSource: "TEST",
      }));
      await prisma.$transaction((tx) => upsertMeasuredInterval(tx, {
        inverterId: inverter.id,
        kind: EnergyIntervalKind.PRODUCTION,
        startAt,
        endAt,
        kwh: 0.8,
        predicted: false,
        correctionReason: "LIVE_SNAPSHOT_REFRESH",
      }));
      const snapshot = await prisma.energyForecastSnapshot.findUniqueOrThrow({
        where: {
          inverterId_kind_generatedAt_targetStartAt: {
            inverterId: inverter.id,
            kind: EnergyIntervalKind.PRODUCTION,
            generatedAt,
            targetStartAt: startAt,
          },
        },
      });
      expect(snapshot).toMatchObject({
        predictedKwh: 1.2,
        actualKwh: 0.8,
        horizonMinutes: 180,
        modelVersion: "test-v1",
        source: "TEST",
      });
      expect(snapshot.actualObservedAt).toBeInstanceOf(Date);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
