import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { persistInvoiceAiDraft } from "./invoice-ai";

const databaseDescribe =
  process.env.RUN_DB_INTEGRATION_TESTS === "true" ? describe : describe.skip;
const marker = `invoice-ai-${randomUUID()}`;
let userId = 0;
let documentId = "";

databaseDescribe("review-only invoice AI persistence", () => {
  afterAll(async () => {
    if (documentId)
      await prisma.auditLog.deleteMany({
        where: { entityType: "EnergyInvoiceDocument", entityId: documentId },
      });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("stores an idempotent draft without changing the technical profile", async () => {
    const user = await prisma.user.create({
      data: {
        email: `${marker}@example.test`,
        passwordHash: "not-a-login-password",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });
    userId = user.id;
    const site = await prisma.energySite.create({
      data: {
        userId,
        provider: "DEMO",
        externalSiteId: marker,
        name: "AI invoice fixture",
      },
    });
    const request = await prisma.energyInvoiceRequest.create({
      data: {
        energySiteId: site.id,
        referenceCode: marker,
        status: "PROCESSING",
      },
    });
    const document = await prisma.energyInvoiceDocument.create({
      data: {
        invoiceRequestId: request.id,
        storageProvider: "DATABASE_ENCRYPTED",
        storageKey: `test:${marker}`,
        originalFileName: "faktura.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        contentSha256: "a".repeat(64),
        retainedUntil: new Date(Date.now() + 86_400_000),
      },
    });
    documentId = document.id;
    const draft = {
      schemaVersion: "energy-invoice-ai-v1",
      billingPeriodFrom: "2026-01-01",
      billingPeriodTo: "2026-02-01",
      values: {
        ean: null,
        address: null,
        distributorCode: null,
        distributionTariffCode: "D25d",
        phases: 3,
        mainFuseA: 25,
        buyPricingMode: "FIX",
        sellPricingMode: "FIX",
        currentSupplierName: "Dodavatel",
        currentProductName: "Produkt",
        monthlySupplierFeeCzk: 120,
        fixedBuyPriceCzkKwh: 3.5,
        fixedSellPriceCzkKwh: 1,
        spotBuyFeeCzkKwh: null,
        spotSellFeeCzkKwh: null,
        fixedPriceValidUntil: "2027-01-01",
        hdoStatus: "MISSING",
      },
      fieldEvidence: [
        { field: "mainFuseA", confidence: "HIGH", evidence: "3×25 A" },
      ],
      warnings: ["HDO kalendář na faktuře není."],
    };

    await expect(
      persistInvoiceAiDraft(document.id, request.id, draft),
    ).resolves.toMatchObject({ duplicate: false });
    await expect(
      persistInvoiceAiDraft(document.id, request.id, draft),
    ).resolves.toMatchObject({ duplicate: true });

    const [savedRequest, extraction, profile, auditCount] = await Promise.all([
      prisma.energyInvoiceRequest.findUniqueOrThrow({
        where: { id: request.id },
      }),
      prisma.energyInvoiceExtraction.findMany({
        where: { invoiceRequestId: request.id },
      }),
      prisma.energySiteTechnicalProfile.findUnique({
        where: { energySiteId: site.id },
      }),
      prisma.auditLog.count({
        where: {
          action: "ENERGY_INVOICE_AI_DRAFT_CREATED",
          entityId: document.id,
        },
      }),
    ]);
    expect(savedRequest.status).toBe("NEEDS_INPUT");
    expect(extraction).toHaveLength(1);
    expect(extraction[0]?.method).toBe("AI_CODEX_DRAFT");
    expect(profile).toBeNull();
    expect(auditCount).toBe(1);
  });
});
