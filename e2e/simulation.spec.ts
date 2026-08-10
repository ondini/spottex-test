import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

import { runInternalJobsEventually } from "./helpers/run-jobs";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();
const suffix = randomUUID();
const email = `simulation-${suffix}@example.test`;
const password = "Spottex-Simulation-2026!";
let userId: number | null = null;
let siteId: number | null = null;
let consentSessionId: string | null = null;
let distributorId: number | null = null;

test.describe.serial("Spottex savings simulation", () => {
  test.beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 12),
        name: "Simulační uživatel",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });
    userId = user.id;
    const site = await prisma.energySite.create({
      data: {
        userId: user.id,
        provider: "DEMO",
        externalSiteId: `simulation-site-${suffix}`,
        name: "Testovací FVE",
        status: "ONLINE",
        optimizationOn: false,
        metadata: { batteryCapacityKwh: 10, pvCapacityKwp: 10 },
      },
    });
    siteId = site.id;
    const inverter = await prisma.inverter.create({
      data: {
        energySiteId: site.id,
        provider: "DEMO",
        externalDeviceId: `simulation-inverter-${suffix}`,
        status: "ONLINE",
      },
    });
    const start = new Date(Date.UTC(2026, 5, 1));
    const distributor = await prisma.energyCompany.create({
      data: {
        code: `E2E_DIST_${suffix}`,
        name: "E2E distributor",
        roles: ["DISTRIBUTOR"],
      },
    });
    distributorId = distributor.id;
    const tariff = await prisma.distributionTariff.create({
      data: { distributorId: distributor.id, code: "D25d", name: "E2E D25d" },
    });
    const distributionVersion = await prisma.distributionTariffVersion.create({
      data: {
        distributionTariffId: tariff.id,
        validFrom: new Date("2026-01-01T00:00:00Z"),
        status: "PUBLISHED",
        distributionVtCzkKwh: 2,
        distributionNtCzkKwh: 0.2,
        breakerFees: { "3x20": 200, "3x25": 300 },
      },
    });
    await prisma.energySiteTechnicalProfile.create({
      data: {
        energySiteId: site.id,
        pvCapacityKwp: 10,
        batteryCapacityKwh: 10,
        batteryMaxChargeKw: 5,
        batteryMaxDischargeKw: 5,
        batteryMinSocPct: 5,
        batteryMaxSocPct: 95,
        batteryRoundtripEfficiencyPct: 90,
        maxGridInputKw: 20,
        maxGridOutputKw: 10,
        phases: 3,
        mainFuseA: 25,
        exportAllowed: true,
        analysisConfirmedAt: new Date(),
      },
    });
    const curve = await prisma.energyPriceCurve.create({
      data: {
        energySiteId: site.id,
        distributionVersionId: distributionVersion.id,
        fingerprint: `simulation-curve-${suffix}`,
        purpose: "CURRENT_BASELINE",
        algorithmVersion: "E2E",
        validFrom: start,
        validTo: new Date(start.getTime() + 96 * 15 * 60_000),
        monthlyFixedCzk: 120,
        status: "READY",
        assumptions: { hdoMode: "MODEL:NIGHT_22_06", exactHdo: false },
      },
    });
    await prisma.$transaction(
      Array.from({ length: 96 }, (_, interval) => {
        const hour = Math.floor(interval / 4);
        const startAt = new Date(start.getTime() + interval * 15 * 60_000);
        const endAt = new Date(startAt.getTime() + 15 * 60_000);
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
  });

  test.afterAll(async () => {
    if (consentSessionId) {
      await prisma.consentRecord.deleteMany({
        where: { sessionId: consentSessionId },
      });
    }
    if (userId) {
      const runs = await prisma.energyAnalysisRun.findMany({
        where: { userId },
        select: { id: true },
      });
      const jobs = await prisma.scheduledJob.findMany({
        where: {
          type: "ENERGY_ANALYSIS_V2",
          idempotencyKey: {
            in: runs.map((run) => `energy-analysis:${run.id}`),
          },
        },
        select: { id: true },
      });
      await prisma.emailOutbox.deleteMany({
        where: {
          idempotencyKey: {
            in: runs.map((run) => `energy-analysis-v2:${run.id}:completed`),
          },
        },
      });
      await prisma.auditLog.deleteMany({ where: { actorUserId: userId } });
      await prisma.scheduledJob.deleteMany({
        where: { id: { in: jobs.map((job) => job.id) } },
      });
      await prisma.invoiceItem.deleteMany({ where: { invoice: { userId } } });
      await prisma.invoice.deleteMany({ where: { userId } });
      await prisma.payment.deleteMany({ where: { userId } });
      await prisma.energyAnalysisRun.deleteMany({ where: { userId } });
      if (siteId) await prisma.energySite.deleteMany({ where: { id: siteId } });
      if (distributorId) {
        await prisma.distributionTariff.deleteMany({
          where: { distributorId },
        });
        await prisma.energyCompany.deleteMany({ where: { id: distributorId } });
      }
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });

  test("queues, processes and renders a result matrix", async ({ page }) => {
    expect(userId).not.toBeNull();
    const fixtureUserId = userId as number;
    await page.goto("/prihlaseni?callbackUrl=/app/analyza");
    const consentButton = page.getByRole("button", { name: "Pouze nezbytné" });
    if (await consentButton.isVisible()) {
      await consentButton.click();
      await expect(consentButton).toBeHidden();
      consentSessionId = await page.evaluate(() =>
        window.sessionStorage.getItem("spottex_analytics_session"),
      );
    }
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Heslo", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Přihlásit se" }).click();
    await page.waitForURL((url) => url.pathname === "/app/analyza", {
      timeout: 20_000,
    });

    await expect(
      page.getByRole("heading", { level: 1, name: "Analýza úspor" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Spočítat základní úspory" })
      .click();
    await expect(page.getByText("Čeká na výpočet", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Zrušit" }).click();
    await expect(page.getByText("Čeká na výpočet", { exact: false })).toBeHidden();
    await page
      .getByRole("button", { name: "Spočítat základní úspory" })
      .click();
    await expect(page.getByText("Čeká na výpočet", { exact: false })).toBeVisible();

    await runInternalJobsEventually();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Poslední výpočet" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Roční náklady podle sazby a produktu",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Roční náklad" }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Nákup → prodej" }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Přínos optima" }),
    ).toBeVisible();
    const smart = await prisma.energyAnalysisScenario.findFirst({
      where: {
        analysisRun: { userId: fixtureUserId, kind: "BASE" },
        controlMode: "SMART",
        priceCurve: { purpose: "CURRENT_BASELINE" },
      },
      orderBy: { createdAt: "desc" },
    });
    expect(smart?.savingsVsBaselineCzk).not.toBeNull();
    expect(Number(smart?.savingsProductCzk)).toBe(0);
    expect(Number(smart?.savingsDistributionCzk)).toBe(0);
    expect(Number(smart?.savingsControlCzk)).toBeCloseTo(
      Number(smart?.savingsVsBaselineCzk),
      2,
    );
    expect(smart?.annualCostCzk).not.toBeNull();
  });

  test("prices Pro points before payment and queues only the paid immutable run", async ({
    page,
  }) => {
    expect(userId).not.toBeNull();
    const fixtureUserId = userId as number;
    await page.goto("/prihlaseni?callbackUrl=/app/analyza");
    const consentButton = page.getByRole("button", { name: "Pouze nezbytné" });
    if (await consentButton.isVisible()) await consentButton.click();
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Heslo", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Přihlásit se" }).click();
    await page.waitForURL((url) => url.pathname === "/app/analyza", {
      timeout: 20_000,
    });

    await page.getByText(/Pokročilá analýza změn FVE a baterie/).click();
    await page.getByLabel("Kapacita baterie (kWh)").fill("10 15");
    await page.getByLabel("Nabíjecí výkon baterie (kW)").fill("5 7");
    await page.getByLabel("Hlavní jistič (A)").fill("20 25");
    await expect(
      page.getByText("7 placených bodů", { exact: false }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Připravit objednávku analýzy" })
      .click();
    await expect(
      page.getByText("7 bodů jsou připraveny", { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Zaplatit a spustit" }).click();
    await page.waitForURL((url) => url.pathname === "/platba/mock", {
      timeout: 20_000,
    });
    await expect(
      page.getByText("35,00 Kč", { exact: false }).first(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Simulovat úspěšnou platbu" })
      .click();
    await page.waitForURL((url) => url.pathname === "/platba/navrat", {
      timeout: 20_000,
    });

    await expect
      .poll(
        async () =>
          await prisma.energyAnalysisRun.findFirst({
            where: { userId: fixtureUserId, kind: "PRO" },
            orderBy: { createdAt: "desc" },
            select: {
              status: true,
              proPriceMinor: true,
              billablePointCount: true,
            },
          }),
      )
      .toEqual({
        status: "QUEUED",
        proPriceMinor: 3500,
        billablePointCount: 7,
      });
  });

  test("charges the flat fee before comparing every published tariff", async ({
    page,
  }) => {
    expect(userId).not.toBeNull();
    const fixtureUserId = userId as number;
    await page.goto("/prihlaseni?callbackUrl=/app/analyza");
    if (await page.getByRole("button", { name: "Pouze nezbytné" }).isVisible())
      await page.getByRole("button", { name: "Pouze nezbytné" }).click();
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Heslo", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Přihlásit se" }).click();
    await page.waitForURL((url) => url.pathname === "/app/analyza", {
      timeout: 20_000,
    });

    await page.getByText(/Pokročilá analýza změn FVE a baterie/).click();
    await page
      .getByRole("checkbox", { name: /Porovnat všechny publikované ceníky/ })
      .check();
    await expect(
      page.getByText(/0 placených bodů · všechny ceníky · 100/),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Připravit objednávku analýzy" })
      .click();
    await expect(
      page.getByText("Porovnání všech ceníků je připravené", { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Zaplatit a spustit" }).click();
    await page.waitForURL((url) => url.pathname === "/platba/mock", {
      timeout: 20_000,
    });
    await expect(
      page.getByText("100,00 Kč", { exact: false }).first(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Simulovat úspěšnou platbu" })
      .click();
    await page.waitForURL((url) => url.pathname === "/platba/navrat", {
      timeout: 20_000,
    });

    await expect
      .poll(async () =>
        prisma.energyAnalysisRun.findFirst({
          where: { userId: fixtureUserId, kind: "PRO" },
          orderBy: { createdAt: "desc" },
          select: {
            status: true,
            proPriceMinor: true,
            billablePointCount: true,
            inputs: true,
          },
        }),
      )
      .toMatchObject({
        status: "QUEUED",
        proPriceMinor: 10_000,
        billablePointCount: 0,
        inputs: { compareAllTariffs: true },
      });
  });
});
