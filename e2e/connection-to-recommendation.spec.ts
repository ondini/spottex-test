import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();
const suffix = randomUUID();
const email = `journey-${suffix}@example.test`;
const password = "Spottex-Journey-2026!";
let userId: number | null = null;
let siteId: number | null = null;
let connectedSiteIds: number[] = [];
let distributorId: number | null = null;
let consentSessionId: string | null = null;
let selectedPlantIdsRequest: string[] = [];

async function createConnectedPlant() {
  if (!userId || siteId) return;
  const site = await prisma.energySite.create({
    data: {
      userId,
      provider: "DEMO",
      externalSiteId: `journey-site-${suffix}`,
      name: "FVE po připojení SolaX",
      status: "ONLINE",
      metadata: { batteryCapacityKwh: 10, pvCapacityKwp: 10 },
    },
  });
  siteId = site.id;
  connectedSiteIds = [site.id];
  const inverter = await prisma.inverter.create({
    data: {
      energySiteId: site.id,
      provider: "DEMO",
      externalDeviceId: `journey-inverter-${suffix}`,
      status: "ONLINE",
    },
  });
  for (const [index, name] of ["MŠ Pohádka", "MŠ Sedmikráska"].entries()) {
    const additionalSite = await prisma.energySite.create({
      data: {
        userId,
        provider: "DEMO",
        externalSiteId: `journey-site-${index + 2}-${suffix}`,
        name,
        status: "ONLINE",
        metadata: { batteryCapacityKwh: 10, pvCapacityKwp: 10 },
      },
    });
    connectedSiteIds.push(additionalSite.id);
    await prisma.inverter.create({
      data: {
        energySiteId: additionalSite.id,
        provider: "DEMO",
        externalDeviceId: `journey-inverter-${index + 2}-${suffix}`,
        status: "ONLINE",
      },
    });
  }
  await prisma.energySiteTechnicalProfile.create({
    data: {
      energySiteId: site.id,
      distributorCode: "CEZ_DISTRIBUCE",
      distributionTariffCode: "D25d",
      pvCapacityKwp: 10,
      batteryCapacityKwh: 10,
      batteryMaxChargeKw: 5,
      batteryMaxDischargeKw: 5,
      batteryMinSocPct: 5,
      batteryMaxSocPct: 95,
      batteryRoundtripEfficiencyPct: 90,
      maxGridInputKw: 20,
      maxGridOutputKw: 10,
      exportAllowed: true,
      hdoStatus: "MODELED",
    },
  });
  await prisma.energySiteFieldEvidence.createMany({
    data: [
      {
        energySiteId: site.id,
        field: "pvCapacityKwp",
        value: 10,
        source: "SOLAX",
        sourceReference: "mocked connection payload",
      },
      {
        energySiteId: site.id,
        field: "batteryCapacityKwh",
        value: 10,
        source: "SOLAX",
        sourceReference: "mocked connection payload",
      },
    ],
  });
  const distributor = await prisma.energyCompany.create({
    data: {
      code: `JOURNEY_DIST_${suffix}`,
      name: "Journey distributor",
      roles: ["DISTRIBUTOR"],
    },
  });
  distributorId = distributor.id;
  const tariff = await prisma.distributionTariff.create({
    data: { distributorId: distributor.id, code: "D25d", name: "Journey D25d" },
  });
  const version = await prisma.distributionTariffVersion.create({
    data: {
      distributionTariffId: tariff.id,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      status: "PUBLISHED",
      distributionVtCzkKwh: 2,
      distributionNtCzkKwh: 0.2,
      breakerFees: { "3x25": 300 },
    },
  });
  const start = new Date(Date.UTC(2026, 5, 1));
  const curve = await prisma.energyPriceCurve.create({
    data: {
      energySiteId: site.id,
      distributionVersionId: version.id,
      fingerprint: `journey-curve-${suffix}`,
      purpose: "CURRENT_BASELINE",
      algorithmVersion: "E2E_JOURNEY",
      validFrom: start,
      validTo: new Date(start.getTime() + 96 * 900_000),
      monthlyFixedCzk: 120,
      status: "READY",
      assumptions: { hdoMode: "MODEL:NIGHT_22_06", exactHdo: false },
    },
  });
  await prisma.$transaction(
    Array.from({ length: 96 }, (_, index) => {
      const startAt = new Date(start.getTime() + index * 900_000);
      const endAt = new Date(startAt.getTime() + 900_000);
      const hour = Math.floor(index / 4);
      return [
        prisma.energyInterval.create({
          data: {
            inverterId: inverter.id,
            kind: "PRODUCTION",
            startAt,
            endAt,
            kwh: hour >= 8 && hour <= 17 ? 0.3 : 0,
          },
        }),
        prisma.energyInterval.create({
          data: {
            inverterId: inverter.id,
            kind: "CONSUMPTION",
            startAt,
            endAt,
            kwh: hour >= 17 && hour <= 22 ? 0.275 : 0.0875,
          },
        }),
        prisma.energyPriceCurvePoint.create({
          data: {
            curveId: curve.id,
            startAt,
            endAt,
            lowTariff: hour < 6,
            commodityBuyCzkKwh: hour < 6 ? 1 : 5,
            commoditySellCzkKwh: 0.5,
            distributionCzkKwh: 1,
            otherRegulatedCzkKwh: 0.5,
            totalBuyCzkKwh: hour < 6 ? 2.5 : 6.5,
            totalSellCzkKwh: 0.5,
          },
        }),
      ];
    }).flat(),
  );
}

test.describe
  .serial("customer journey from connection to recommendation", () => {
  test.beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 12),
        name: "Journey user",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });
    userId = user.id;
  });

  test.afterAll(async () => {
    if (consentSessionId)
      await prisma.consentRecord.deleteMany({
        where: { sessionId: consentSessionId },
      });
    if (userId) {
      const runs = await prisma.energyAnalysisRun.findMany({
        where: { userId },
        select: { id: true },
      });
      await prisma.emailOutbox.deleteMany({
        where: {
          idempotencyKey: {
            in: runs.map((run) => `energy-analysis-v2:${run.id}:completed`),
          },
        },
      });
      await prisma.scheduledJob.deleteMany({
        where: {
          idempotencyKey: {
            in: runs.map((run) => `energy-analysis:${run.id}`),
          },
        },
      });
      await prisma.auditLog.deleteMany({ where: { actorUserId: userId } });
      await prisma.energyAnalysisRun.deleteMany({ where: { userId } });
    }
    if (connectedSiteIds.length) {
      await prisma.energySite.deleteMany({
        where: { id: { in: connectedSiteIds } },
      });
    }
    if (distributorId) {
      await prisma.distributionTariff.deleteMany({ where: { distributorId } });
      await prisma.energyCompany.deleteMany({ where: { id: distributorId } });
    }
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test("connects SolaX, confirms inferred inputs, computes and shows a recommendation", async ({
    page,
  }) => {
    // The analysis is processed asynchronously by the worker. Keep the test-wide
    // timeout above the explicit 90 s poll below; Playwright's 30 s default would
    // otherwise abort a healthy run before the poll can finish.
    test.setTimeout(120_000);

    await page.route("**/api/app/energy/dashboard**", async (route) => {
      if (!siteId)
        return route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({
            error: "K účtu zatím není připojena žádná elektrárna.",
            code: "NO_SITES",
            connectorConfigured: true,
          }),
        });
      return route.continue();
    });
    await page.route("**/api/app/energy/connect", async (route) => {
      const input = route.request().postDataJSON() as { plantIds?: string[] };
      if (!input.plantIds?.length) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            requiresSelection: true,
            discoveryId: "discovery-token-1234567890",
            message: "Vyberte jednu nebo více ze 4 nalezených elektráren.",
            plants: [
              {
                plantId: "plant-1",
                name: "MŠ Větrník",
                location: "Litoměřice, CZ",
                pvCapacityKwp: 20,
                batteryCapacityKwh: 23.2,
                createdAt: "2025-01-01T00:00:00Z",
                deviceCoverage: {
                  status: "COMPLETE",
                  availableRatedPowerKw: 20,
                  expectedCapacityKwp: 20,
                  percent: 100,
                  warning: null,
                },
                inverters: [
                  { model: "X3-HYBRID", ratedPowerKw: 10, serialSuffix: "111111" },
                  { model: "X3-HYBRID", ratedPowerKw: 10, serialSuffix: "222222" },
                ],
              },
              {
                plantId: "plant-2",
                name: "MŠ Pohádka",
                location: "Litoměřice, CZ",
                pvCapacityKwp: 50,
                batteryCapacityKwh: 46.4,
                createdAt: "2025-02-01T00:00:00Z",
                deviceCoverage: {
                  status: "COMPLETE",
                  availableRatedPowerKw: 50,
                  expectedCapacityKwp: 50,
                  percent: 100,
                  warning: null,
                },
                inverters: [
                  { model: "X3-HYBRID", ratedPowerKw: 25, serialSuffix: "333333" },
                  { model: "X3-HYBRID", ratedPowerKw: 25, serialSuffix: "444444" },
                ],
              },
              {
                plantId: "plant-3",
                name: "MŠ Sedmikráska",
                location: "Litoměřice, CZ",
                pvCapacityKwp: 54,
                batteryCapacityKwh: 46.4,
                createdAt: "2025-03-01T00:00:00Z",
                deviceCoverage: {
                  status: "POSSIBLY_INCOMPLETE",
                  availableRatedPowerKw: 25,
                  expectedCapacityKwp: 54,
                  percent: 46.3,
                  warning: "SolaX zpřístupňuje jen část očekávaného výkonu elektrárny.",
                },
                inverters: [
                  { model: "X3-HYBRID", ratedPowerKw: 25, serialSuffix: "555555" },
                ],
              },
              {
                plantId: "plant-4",
                name: "Nevybraná elektrárna",
                location: "Litoměřice, CZ",
                pvCapacityKwp: 10,
                batteryCapacityKwh: null,
                createdAt: "2025-04-01T00:00:00Z",
                deviceCoverage: {
                  status: "COMPLETE",
                  availableRatedPowerKw: 10,
                  expectedCapacityKwp: 10,
                  percent: 100,
                  warning: null,
                },
                inverters: [
                  { model: "X1-HYBRID", ratedPowerKw: 10, serialSuffix: "666666" },
                ],
              },
            ],
          }),
        });
      }
      selectedPlantIdsRequest = input.plantIds;
      await createConnectedPlant();
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          requiresSelection: false,
          queuedHistoryImports: 3,
          sites: [
            { id: connectedSiteIds[0], name: "FVE po připojení SolaX" },
            { id: connectedSiteIds[1], name: "MŠ Pohádka" },
            { id: connectedSiteIds[2], name: "MŠ Sedmikráska" },
          ],
        }),
      });
    });

    await page.goto("/prihlaseni?callbackUrl=/app/dashboard");
    const consent = page.getByRole("button", { name: "Pouze nezbytné" });
    if (await consent.isVisible()) {
      await consent.click();
      consentSessionId = await page.evaluate(() =>
        window.sessionStorage.getItem("spottex_analytics_session"),
      );
    }
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Heslo", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Přihlásit se" }).click();
    await page.waitForURL((url) => url.pathname === "/app/dashboard", {
      timeout: 20_000,
    });
    await expect(
      page.getByRole("heading", { level: 1, name: "Připojte svoji elektrárnu" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Energetický přehled" })).toHaveCount(0);
    await page.getByLabel("E-mail do SolaX Cloud").fill("owner@solax.example");
    await page.getByLabel("Heslo do SolaX Cloud").fill("one-time-password");
    const emailBox = await page.getByLabel("E-mail do SolaX Cloud").boundingBox();
    const passwordBox = await page.getByLabel("Heslo do SolaX Cloud").boundingBox();
    const connectBox = await page.getByRole("button", { name: "Načíst elektrárny" }).boundingBox();
    expect(emailBox?.y).toBe(passwordBox?.y);
    expect(passwordBox?.y).toBe(connectBox?.y);
    await page.getByRole("button", { name: "Načíst elektrárny" }).click();
    await expect(page.getByText("MŠ Pohádka")).toBeVisible();
    await expect(page.getByText(/část očekávaného výkonu/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Připojit vybrané (0)" })).toBeDisabled();
    await page.getByRole("checkbox", { name: /MŠ Větrník/ }).check();
    await page.getByRole("checkbox", { name: /MŠ Pohádka/ }).check();
    await page.getByRole("checkbox", { name: /MŠ Sedmikráska/ }).check();
    await expect(page.getByText("Vybráno 3 z 4.")).toBeVisible();
    await page.getByRole("button", { name: "Připojit vybrané (3)" }).click();
    await expect
      .poll(() => selectedPlantIdsRequest)
      .toEqual(["plant-1", "plant-2", "plant-3"]);
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "FVE po připojení SolaX",
      }),
    ).toBeVisible({ timeout: 15_000 });
    const siteSwitcher = page.getByLabel("Aktivní elektrárna");
    await expect(siteSwitcher).toBeVisible();
    await expect(siteSwitcher.locator("option")).toHaveCount(3);
    await expect(siteSwitcher.locator("option")).toHaveText([
      "FVE po připojení SolaX",
      "MŠ Pohádka",
      "MŠ Sedmikráska",
    ]);
    await siteSwitcher.selectOption(String(connectedSiteIds[1]));
    await page.waitForURL(
      (url) => url.searchParams.get("siteId") === String(connectedSiteIds[1]),
    );
    await expect(
      page.getByRole("heading", { level: 2, name: "MŠ Pohádka" }),
    ).toBeVisible();
    await siteSwitcher.selectOption(String(connectedSiteIds[0]));
    await page.waitForURL(
      (url) => url.searchParams.get("siteId") === String(connectedSiteIds[0]),
    );

    await page.goto("/app/analyza");
    const analysisSiteSwitcher = page.getByLabel("Aktivní elektrárna");
    await analysisSiteSwitcher.selectOption(String(connectedSiteIds[1]));
    await page.waitForURL(
      (url) =>
        url.pathname === "/app/analyza" &&
        url.searchParams.get("siteId") === String(connectedSiteIds[1]),
    );
    await expect(
      page.locator("main").getByText("MŠ Pohádka", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Připravujeme podklady")).toBeVisible();
    await analysisSiteSwitcher.selectOption(String(connectedSiteIds[0]));
    await page.waitForURL(
      (url) =>
        url.pathname === "/app/analyza" &&
        url.searchParams.get("siteId") === String(connectedSiteIds[0]),
    );
    await page.getByRole("button", { name: "Spočítat základní úspory" }).click();
    await expect
      .poll(async () =>
        prisma.energyAnalysisRun.count({
          where: { userId: userId!, status: "COMPLETED" },
        }),
        { timeout: 90_000 },
      )
      .toBe(1);

    await page.reload();
    await expect(page.getByText("Roční náklady na energii")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "D02d" })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: "Fix → fix" })).toBeVisible();
  });
});
