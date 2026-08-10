import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

import { persistInvoiceAiDraft } from "../src/lib/energy/invoice-ai";

loadEnvConfig(process.cwd());
const prisma = new PrismaClient();
const suffix = randomUUID();
const adminEmail = `invoice-ai-admin-${suffix}@example.test`;
const ownerEmail = `invoice-ai-owner-${suffix}@example.test`;
const password = "Spottex-Invoice-AI-2026!";
let adminId = 0;
let ownerId = 0;
let siteId = 0;
let requestId = "";
let documentId = "";
let consentSessionId: string | null = null;

test.describe("invoice AI draft requires human confirmation", () => {
  test.beforeAll(async () => {
    const passwordHash = await bcrypt.hash(password, 12);
    const [admin, owner] = await prisma.$transaction([
      prisma.user.create({
        data: {
          email: adminEmail,
          passwordHash,
          role: "ADMIN",
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
        },
      }),
      prisma.user.create({
        data: {
          email: ownerEmail,
          passwordHash,
          role: "USER",
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
        },
      }),
    ]);
    adminId = admin.id;
    ownerId = owner.id;
    const site = await prisma.energySite.create({
      data: {
        userId: owner.id,
        provider: "DEMO",
        externalSiteId: `invoice-ai-${suffix}`,
        name: `AI faktura ${suffix}`,
        status: "ONLINE",
      },
    });
    siteId = site.id;
    const request = await prisma.energyInvoiceRequest.create({
      data: {
        energySiteId: site.id,
        referenceCode: `AI-${suffix}`,
        status: "PROCESSING",
      },
    });
    requestId = request.id;
    const document = await prisma.energyInvoiceDocument.create({
      data: {
        invoiceRequestId: request.id,
        storageProvider: "DATABASE_ENCRYPTED",
        storageKey: `e2e:${suffix}`,
        originalFileName: "ai-navrh.pdf",
        mimeType: "application/pdf",
        sizeBytes: 42,
        contentSha256: "b".repeat(64),
        retainedUntil: new Date(Date.now() + 86_400_000),
      },
    });
    documentId = document.id;
    await persistInvoiceAiDraft(document.id, request.id, {
      schemaVersion: "energy-invoice-ai-v1",
      billingPeriodFrom: "2026-01-01",
      billingPeriodTo: "2026-02-01",
      values: {
        ean: null,
        address: null,
        distributorCode: "CEZ_DISTRIBUCE",
        distributionTariffCode: "D25d",
        phases: 3,
        mainFuseA: 25,
        buyPricingMode: "FIX",
        sellPricingMode: "FIX",
        currentSupplierName: "Test Energie",
        currentProductName: "Fix 2026",
        monthlySupplierFeeCzk: 120,
        fixedBuyPriceCzkKwh: 3.5,
        fixedSellPriceCzkKwh: 1,
        spotBuyFeeCzkKwh: null,
        spotSellFeeCzkKwh: null,
        fixedPriceValidUntil: "2027-01-01",
        hdoStatus: "MISSING",
      },
      fieldEvidence: [
        {
          field: "mainFuseA",
          confidence: "HIGH",
          evidence: "Na faktuře je 3×25 A.",
        },
      ],
      warnings: ["Přesné časy HDO na faktuře nejsou."],
    });
  });

  test.afterAll(async () => {
    if (consentSessionId) {
      await prisma.analyticsEvent.deleteMany({
        where: { sessionId: consentSessionId },
      });
      await prisma.consentRecord.deleteMany({
        where: { sessionId: consentSessionId },
      });
    }
    await prisma.emailOutbox.deleteMany({ where: { toEmail: ownerEmail } });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorUserId: { in: [adminId, ownerId].filter(Boolean) } },
          { entityId: { in: [requestId, documentId].filter(Boolean) } },
        ],
      },
    });
    if (ownerId) await prisma.user.deleteMany({ where: { id: ownerId } });
    if (adminId) await prisma.user.deleteMany({ where: { id: adminId } });
    await prisma.$disconnect();
  });

  test("shows evidence, prefills values and writes only after the admin saves", async ({
    page,
  }) => {
    await page.goto("/prihlaseni?callbackUrl=/admin/vstupni-faktury");
    const consent = page.getByRole("button", { name: "Pouze nezbytné" });
    if (await consent.isVisible()) {
      await consent.click();
      consentSessionId = await page.evaluate(() =>
        window.sessionStorage.getItem("spottex_analytics_session"),
      );
    }
    await page.getByLabel("E-mail").fill(adminEmail);
    await page.getByLabel("Heslo", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Přihlásit se" }).click();
    await page.waitForURL((url) => url.pathname === "/admin/vstupni-faktury", {
      timeout: 20_000,
    });

    const article = page.locator("article", { hasText: `AI-${suffix}` });
    await expect(
      article.getByText("AI návrh – vždy porovnejte s originálem"),
    ).toBeVisible();
    await expect(
      article.getByText("Přesné časy HDO na faktuře nejsou."),
    ).toBeVisible();
    await expect(article.getByLabel("Hlavní jistič (A)")).toHaveValue("25");
    expect(
      await prisma.energySiteTechnicalProfile.findUnique({
        where: { energySiteId: siteId },
      }),
    ).toBeNull();

    await article.getByLabel("Stav zpracování").selectOption("CONFIRMED");
    await article.getByRole("button", { name: "Uložit zpracování" }).click();
    await expect(
      article.getByText("Zpracování bylo uložené", { exact: false }),
    ).toBeVisible();

    await expect
      .poll(async () => ({
        mainFuseA: (
          await prisma.energySiteTechnicalProfile.findUnique({
            where: { energySiteId: siteId },
          })
        )?.mainFuseA,
        methods: (
          await prisma.energyInvoiceExtraction.findMany({
            where: { invoiceRequestId: requestId },
            orderBy: { version: "asc" },
            select: { method: true },
          })
        ).map(({ method }) => method),
      }))
      .toEqual({ mainFuseA: 25, methods: ["AI_CODEX_DRAFT", "MANUAL"] });
  });
});
