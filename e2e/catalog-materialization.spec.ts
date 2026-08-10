import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

loadEnvConfig(process.cwd());
const prisma = new PrismaClient();
const suffix = randomUUID();
const email = `catalog-curve-${suffix}@example.test`;
const password = "Spottex-Catalog-2026!";
let userId = 0;
let siteId = 0;
let companyId = 0;
let productId = 0;
let tariffId = 0;

test.describe("published catalog to customer analysis", () => {
  test.beforeAll(async () => {
    const user = await prisma.user.create({ data: { email, passwordHash: await bcrypt.hash(password, 12), status: "ACTIVE", emailVerifiedAt: new Date() } });
    userId = user.id;
    const site = await prisma.energySite.create({ data: { userId, provider: "DEMO", externalSiteId: `catalog-${suffix}`, name: "Katalogová FVE", status: "ONLINE" } });
    siteId = site.id;
    const inverter = await prisma.inverter.create({ data: { energySiteId: siteId, provider: "DEMO", externalDeviceId: `catalog-inverter-${suffix}`, status: "ONLINE" } });
    await prisma.energySiteTechnicalProfile.create({ data: { energySiteId: siteId, distributorCode: `DIST-${suffix}`, distributionTariffCode: "D25d", phases: 3, mainFuseA: 25, pvCapacityKwp: 8, batteryCapacityKwh: 10, batteryMaxChargeKw: 5, batteryMaxDischargeKw: 5, maxGridInputKw: 17.25, maxGridOutputKw: 8, exportAllowed: true, currentSupplierName: "Současný dodavatel", currentProductName: "Moje smlouva", buyPricingMode: "FIX", sellPricingMode: "FIX", monthlySupplierFeeCzk: 50, fixedBuyPriceCzkKwh: 4, fixedSellPriceCzkKwh: 0.8, analysisConfirmedAt: new Date() } });
    const start = new Date("2026-06-01T00:00:00.000Z");
    await prisma.$transaction(Array.from({ length: 96 }, (_, index) => {
      const startAt = new Date(start.getTime() + index * 900_000);
      const endAt = new Date(startAt.getTime() + 900_000);
      return [
        prisma.energyInterval.create({ data: { inverterId: inverter.id, kind: "PRODUCTION", startAt, endAt, kwh: index >= 28 && index < 76 ? 0.2 : 0 } }),
        prisma.energyInterval.create({ data: { inverterId: inverter.id, kind: "CONSUMPTION", startAt, endAt, kwh: 0.1 } }),
      ];
    }).flat());
    const company = await prisma.energyCompany.create({ data: { code: `DIST-${suffix}`, name: "Testovací dodavatel a distributor", roles: ["SUPPLIER", "DISTRIBUTOR"] } });
    companyId = company.id;
    const product = await prisma.energyProduct.create({ data: { supplierId: company.id, code: `FIX-${suffix}`, name: "Ověřený fix" } });
    productId = product.id;
    await prisma.energyProductVersion.create({ data: { productId: product.id, validFrom: new Date("2026-01-01T00:00:00.000Z"), validTo: new Date("2027-01-01T00:00:00.000Z"), status: "PUBLISHED", buyMode: "FIX", sellMode: "FIX", fixedBuyVtCzkKwh: 3, fixedBuyNtCzkKwh: 2, fixedSellVtCzkKwh: 1, fixedSellNtCzkKwh: 1, monthlyFeeCzk: 100 } });
    const tariff = await prisma.distributionTariff.create({ data: { distributorId: company.id, code: "D25d", name: "Testovací D25d" } });
    tariffId = tariff.id;
    await prisma.distributionTariffVersion.create({ data: { distributionTariffId: tariff.id, validFrom: new Date("2026-01-01T00:00:00.000Z"), validTo: new Date("2027-01-01T00:00:00.000Z"), status: "PUBLISHED", distributionVtCzkKwh: 2, distributionNtCzkKwh: 0.5, systemServicesCzkKwh: 0.1, electricityTaxCzkKwh: 0.03, pozeCzkKwh: 0.2, monthlyMeterFeeCzk: 20, breakerFees: { "3x25": 300 } } });
  });

  test.afterAll(async () => {
    const runs = await prisma.energyAnalysisRun.findMany({ where: { userId }, select: { id: true } });
    await prisma.scheduledJob.deleteMany({ where: { idempotencyKey: { in: runs.map((run) => `energy-analysis:${run.id}`) } } });
    await prisma.energyAnalysisRun.deleteMany({ where: { userId } });
    await prisma.energySite.deleteMany({ where: { id: siteId } });
    await prisma.distributionTariffVersion.deleteMany({ where: { distributionTariffId: tariffId } });
    await prisma.distributionTariff.deleteMany({ where: { id: tariffId } });
    await prisma.energyProductVersion.deleteMany({ where: { productId } });
    await prisma.energyProduct.deleteMany({ where: { id: productId } });
    await prisma.energyCompany.deleteMany({ where: { id: companyId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test("materializes only a published covered combination with disclosed modeled HDO", async ({ page }) => {
    await page.goto("/prihlaseni");
    const consent = page.getByRole("button", { name: "Pouze nezbytné" });
    if (await consent.isVisible()) await consent.click();
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Heslo", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Přihlásit se" }).click();
    await page.waitForURL((url) => url.pathname.startsWith("/app"));
    const response = await page.request.post("/api/app/analyses", { data: { siteId, kind: "BASE", hardwareVariants: [] } });
    expect(response.ok(), await response.text()).toBe(true);
    const curve = await prisma.energyPriceCurve.findFirst({ where: { energySiteId: siteId, status: "READY", purpose: { startsWith: "CATALOG:" } }, include: { _count: { select: { points: true } } } });
    expect(curve?._count.points).toBe(96);
    expect(Number(curve?.monthlyFixedCzk)).toBe(420);
    expect(curve?.assumptions).toMatchObject({ hdoMode: "MODEL:NIGHT_22_06", exactHdo: false, breaker: "3x25" });
    const baseline = await prisma.energyPriceCurve.findFirst({ where: { energySiteId: siteId, status: "READY", purpose: "CURRENT_BASELINE" }, include: { points: { orderBy: { startAt: "asc" }, take: 1 }, _count: { select: { points: true } } } });
    expect(baseline?._count.points).toBe(96);
    expect(Number(baseline?.monthlyFixedCzk)).toBe(370);
    expect(Number(baseline?.points[0].commodityBuyCzkKwh)).toBe(4);
    expect(Number(baseline?.points[0].commoditySellCzkKwh)).toBe(0.8);
    expect(baseline?.assumptions).toMatchObject({ priceInput: { supplier: "Současný dodavatel", product: "Moje smlouva" } });
  });
});
