import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { materializeModeledStandardPriceCurve } from "./materialize";

const run =
  process.env.RUN_DB_INTEGRATION_TESTS === "true" ? describe : describe.skip;
const marker = `modeled-standard-${Date.now()}`;
let userId = 0;
let siteId = 0;

run("modeled Czech standard price curve", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `${marker}@example.test`,
        passwordHash: "test",
        status: "ACTIVE",
        role: "ADMIN",
        emailVerifiedAt: new Date(),
      },
    });
    userId = user.id;
    const site = await prisma.energySite.create({
      data: {
        userId,
        provider: "DEMO",
        externalSiteId: marker,
        name: "Modeled price fixture",
        status: "ONLINE",
        timezone: "Europe/Prague",
      },
    });
    siteId = site.id;
    await prisma.energySiteTechnicalProfile.create({
      data: {
        energySiteId: site.id,
        phases: 3,
        mainFuseA: 25,
        pvCapacityKwp: 10,
        batteryCapacityKwh: 10,
      },
    });
  });

  afterAll(async () => {
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("creates a complete, traceable, VAT-inclusive 15-minute fallback", async () => {
    const curve = await materializeModeledStandardPriceCurve({
      actorUserId: userId,
      energySiteId: siteId,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validTo: new Date("2026-01-02T00:00:00.000Z"),
    });
    const stored = await prisma.energyPriceCurve.findUniqueOrThrow({
      where: { id: curve.id },
      include: { points: { orderBy: { startAt: "asc" } } },
    });

    expect(stored).toMatchObject({
      purpose: "MODELED_STANDARD_CZ_2026",
      algorithmVersion: "SPOTTEX_MODELED_STANDARD_CZ_2026_V4_D02D_FALLBACK",
      status: "READY",
    });
    expect(Number(stored.monthlyFixedCzk)).toBeCloseTo(434.23, 2);
    expect(stored.points).toHaveLength(96);
    expect(stored.points.filter((point) => point.lowTariff)).toHaveLength(0);
    expect(
      stored.points.every(
        (point) => Math.abs(Number(point.totalBuyCzkKwh) - 6.00047) < 1e-8,
      ),
    ).toBe(true);
    expect(
      stored.points.every((point) => Number(point.totalSellCzkKwh) === 0),
    ).toBe(true);
    expect(stored.assumptions).toMatchObject({
      source: "MODELED_DEFAULT",
      analysisOnly: true,
      needsUserConfirmation: false,
      vatIncluded: true,
      hdoMode: "NONE:SINGLE_TARIFF",
    });
    await expect(
      prisma.auditLog.count({
        where: {
          action: "ENERGY_MODELED_STANDARD_CURVE_MATERIALIZED",
          entityId: stored.id,
        },
      }),
    ).resolves.toBe(1);
  });
});
