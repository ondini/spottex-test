import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

import { persistInvoiceAiDraft } from "../src/lib/energy/invoice-ai";

loadEnvConfig(process.cwd());
const prisma = new PrismaClient();
const suffix = randomUUID();
const email = `invoice-customer-${suffix}@example.test`;
const password = "Spottex-Invoice-Customer-2026!";
let userId = 0;
let siteId = 0;
let requestId = "";
let documentId = "";
let consentSessionId: string | null = null;

test.describe("customer invoice review", () => {
  test.beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 12),
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });
    userId = user.id;
    const site = await prisma.energySite.create({
      data: {
        userId: user.id,
        provider: "DEMO",
        externalSiteId: `invoice-customer-${suffix}`,
        name: "Faktura zákazníka",
        status: "ONLINE",
        metadata: { pvCapacityKwp: 9.9, batteryCapacityKwh: 11.6 },
      },
    });
    siteId = site.id;
    const request = await prisma.energyInvoiceRequest.create({
      data: { energySiteId: site.id, referenceCode: `CUSTOMER-${suffix}`, status: "PROCESSING" },
    });
    requestId = request.id;
    const document = await prisma.energyInvoiceDocument.create({
      data: {
        invoiceRequestId: request.id,
        storageProvider: "DATABASE_ENCRYPTED",
        storageKey: `e2e:${suffix}`,
        originalFileName: "faktura-leden.pdf",
        mimeType: "application/pdf",
        sizeBytes: 42,
        contentSha256: "c".repeat(64),
        retainedUntil: new Date(Date.now() + 86_400_000),
      },
    });
    documentId = document.id;
    await persistInvoiceAiDraft(document.id, request.id, {
      schemaVersion: "energy-invoice-ai-v2",
      billingPeriodFrom: "2026-01-01",
      billingPeriodTo: "2026-02-01",
      values: {
        ean: null,
        address: null,
        distributorCode: "CEZ_DISTRIBUCE",
        distributionTariffCode: "D02d",
        phases: 3,
        mainFuseA: 25,
        buyPricingMode: "FIX",
        sellPricingMode: null,
        currentSupplierName: "Test Energie",
        currentProductName: "Fix 2026",
        monthlySupplierFeeCzk: 120,
        fixedBuyPriceCzkKwh: 3.218,
        fixedSellPriceCzkKwh: null,
        spotBuyFeeCzkKwh: null,
        spotSellFeeCzkKwh: null,
        fixedPriceValidUntil: "2027-01-01",
        hdoStatus: "MISSING",
      },
      fieldEvidence: [{ field: "fixedBuyPriceCzkKwh", confidence: "HIGH", evidence: "2 659,50 Kč/MWh bez DPH × 1,21 ÷ 1000." }],
      warnings: ["Výkupní cena na faktuře není."],
    });
  });

  test.afterAll(async () => {
    if (consentSessionId) {
      await prisma.analyticsEvent.deleteMany({ where: { sessionId: consentSessionId } });
      await prisma.consentRecord.deleteMany({ where: { sessionId: consentSessionId } });
    }
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorUserId: userId || undefined },
          { entityId: { in: [requestId, documentId].filter(Boolean) } },
        ],
      },
    });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test("opens extracted output and saves reviewed prices into the site", async ({ page }) => {
    await page.goto(`/prihlaseni?callbackUrl=${encodeURIComponent(`/app/elektrarna?siteId=${siteId}`)}`);
    const consent = page.getByRole("button", { name: "Pouze nezbytné" });
    if (await consent.isVisible()) {
      await consent.click();
      consentSessionId = await page.evaluate(() => window.sessionStorage.getItem("spottex_analytics_session"));
    }
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Heslo", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Přihlásit se" }).click();
    await page.waitForURL((url) => url.pathname === "/app/elektrarna", { timeout: 20_000 });

    const dialog = page.getByRole("dialog", { name: "Zkontrolujte údaje před uložením" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Cena silové elektřiny vč. DPH (Kč/kWh)")).toHaveValue("3.218");
    await expect(dialog.getByText("Výkupní cena na faktuře není.", { exact: false })).toBeVisible();
    await dialog.getByRole("button", { name: "Uložit do odběrného místa" }).click();
    await expect(page.getByText("Potvrzené údaje jsou uložené v odběrném místě.")).toBeVisible();

    await expect.poll(async () => {
      const profile = await prisma.energySiteTechnicalProfile.findUnique({ where: { energySiteId: siteId } });
      return { supplier: profile?.currentSupplierName, fixedBuy: profile?.fixedBuyPriceCzkKwh };
    }).toEqual({ supplier: "Test Energie", fixedBuy: 3.218 });
  });
});
