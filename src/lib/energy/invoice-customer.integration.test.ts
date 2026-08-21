import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { persistInvoiceAiDraft } from "./invoice-ai";
import { confirmCustomerInvoice, getCustomerInvoiceRequest } from "./invoice-customer";

const databaseDescribe = process.env.RUN_DB_INTEGRATION_TESTS === "true" ? describe : describe.skip;
const marker = `invoice-customer-${randomUUID()}`;
let ownerId = 0;
let strangerId = 0;
let requestId = "";
let documentId = "";

databaseDescribe("customer invoice confirmation", () => {
  afterAll(async () => {
    if (requestId || documentId) {
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            ...(requestId ? [{ entityId: requestId }] : []),
            ...(documentId ? [{ entityId: documentId }] : []),
          ],
        },
      });
    }
    if (ownerId || strangerId) {
      await prisma.user.deleteMany({ where: { id: { in: [ownerId, strangerId].filter(Boolean) } } });
    }
    await prisma.$disconnect();
  });

  it("shows only owned drafts and stores an explicitly confirmed proposal", async () => {
    const [owner, stranger] = await prisma.$transaction([
      prisma.user.create({ data: { email: `${marker}-owner@example.test`, passwordHash: "test", status: "ACTIVE", emailVerifiedAt: new Date() } }),
      prisma.user.create({ data: { email: `${marker}-stranger@example.test`, passwordHash: "test", status: "ACTIVE", emailVerifiedAt: new Date() } }),
    ]);
    ownerId = owner.id;
    strangerId = stranger.id;
    const site = await prisma.energySite.create({
      data: { userId: owner.id, provider: "DEMO", externalSiteId: marker, name: "Faktura zákazníka", status: "ONLINE" },
    });
    const request = await prisma.energyInvoiceRequest.create({
      data: { energySiteId: site.id, referenceCode: marker, status: "PROCESSING" },
    });
    requestId = request.id;
    const document = await prisma.energyInvoiceDocument.create({
      data: {
        invoiceRequestId: request.id,
        storageProvider: "DATABASE_ENCRYPTED",
        storageKey: `test:${marker}`,
        originalFileName: "faktura.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        contentSha256: "b".repeat(64),
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
        currentSupplierName: "Dodavatel",
        currentProductName: "Produkt",
        monthlySupplierFeeCzk: 120,
        fixedBuyPriceCzkKwh: 3.2,
        fixedSellPriceCzkKwh: null,
        spotBuyFeeCzkKwh: null,
        spotSellFeeCzkKwh: null,
        fixedPriceValidUntil: "2027-01-01",
        hdoStatus: "MISSING",
      },
      fieldEvidence: [{ field: "fixedBuyPriceCzkKwh", confidence: "HIGH", evidence: "Doložená cena." }],
      warnings: [],
    });

    await expect(getCustomerInvoiceRequest(stranger.id, site.id)).rejects.toThrow("Elektrárna nebyla nalezena.");
    await expect(confirmCustomerInvoice(owner.id, site.id, {
      extracted: { fixedBuyPriceCzkKwh: 3.2 },
      sourceDocumentIds: ["foreign-document"],
    })).rejects.toThrow("INVOICE_DOCUMENT_MISMATCH");

    const before = await getCustomerInvoiceRequest(owner.id, site.id);
    expect(before?.documents[0]?.state).toBe("READY");
    await confirmCustomerInvoice(owner.id, site.id, {
      extracted: {
        distributorCode: "CEZ_DISTRIBUCE",
        distributionTariffCode: "D02d",
        buyPricingMode: "FIX",
        currentSupplierName: "Dodavatel",
        currentProductName: "Produkt",
        monthlySupplierFeeCzk: 120,
        fixedBuyPriceCzkKwh: 3.2,
        fixedPriceValidUntil: "2027-01-01T12:00:00.000Z",
      },
      sourceDocumentIds: [document.id],
    });

    const [savedRequest, profile, evidence, audit] = await Promise.all([
      prisma.energyInvoiceRequest.findUniqueOrThrow({ where: { id: request.id } }),
      prisma.energySiteTechnicalProfile.findUniqueOrThrow({ where: { energySiteId: site.id } }),
      prisma.energySiteFieldEvidence.findFirstOrThrow({ where: { energySiteId: site.id, field: "fixedBuyPriceCzkKwh", source: "INVOICE" }, orderBy: { id: "desc" } }),
      prisma.auditLog.findFirst({ where: { action: "ENERGY_INVOICE_CUSTOMER_CONFIRMED", entityId: request.id } }),
    ]);
    expect(savedRequest.status).toBe("CONFIRMED");
    expect(profile.fixedBuyPriceCzkKwh).toBe(3.2);
    expect(evidence).toMatchObject({ confirmedByUserId: owner.id });
    expect(evidence.confirmedAt).not.toBeNull();
    expect(audit).not.toBeNull();
  });
});
