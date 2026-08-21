import { EnergyInvoiceRequestStatus, Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { INVOICE_AI_FAILED_MARKER } from "./invoice-ai";
import { serializeCustomerInvoiceRequest } from "./invoice-view";

const baseValues = {
  ean: null,
  address: null,
  distributorCode: null,
  distributionTariffCode: "D02d",
  phases: 3,
  mainFuseA: 25,
  buyPricingMode: "FIX" as const,
  sellPricingMode: null,
  currentSupplierName: "Starší dodavatel",
  currentProductName: null,
  monthlySupplierFeeCzk: null,
  fixedBuyPriceCzkKwh: 3.2,
  fixedSellPriceCzkKwh: null,
  spotBuyFeeCzkKwh: null,
  spotSellFeeCzkKwh: null,
  fixedPriceValidUntil: null,
  hdoStatus: "MISSING" as const,
};

function documentFixture(input: {
  id: string;
  createdAt: Date;
  extractedData: Prisma.JsonObject;
  extractionVersion: string | null;
}) {
  return {
    id: input.id,
    invoiceRequestId: "request-1",
    storageProvider: "DATABASE_ENCRYPTED",
    storageKey: `test:${input.id}`,
    encryptedContent: null,
    encryptionVersion: "AES_256_GCM_V1",
    originalFileName: `${input.id}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 100,
    contentSha256: input.id.padEnd(64, "a"),
    billingPeriodFrom: null,
    billingPeriodTo: null,
    extractionVersion: input.extractionVersion,
    extractedData: input.extractedData,
    sensitive: true,
    retainedUntil: new Date("2027-01-01T00:00:00Z"),
    deletedAt: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

describe("customer invoice view", () => {
  it("merges complementary drafts, prefers the newest non-empty value and reports conflicts", () => {
    const olderDraft = {
      schemaVersion: "energy-invoice-ai-v2",
      billingPeriodFrom: "2026-01-01",
      billingPeriodTo: "2026-02-01",
      values: baseValues,
      fieldEvidence: [{ field: "fixedBuyPriceCzkKwh", confidence: "HIGH", evidence: "Cena v detailu." }],
      warnings: [],
    } satisfies Prisma.JsonObject;
    const newerDraft = {
      schemaVersion: "energy-invoice-ai-v2",
      billingPeriodFrom: "2026-02-01",
      billingPeriodTo: "2026-03-01",
      values: {
        ...baseValues,
        distributionTariffCode: null,
        currentSupplierName: "Novější dodavatel",
        currentProductName: "Produkt Plus",
        fixedBuyPriceCzkKwh: null,
      },
      fieldEvidence: [{ field: "currentProductName", confidence: "HIGH", evidence: "Název produktu." }],
      warnings: ["Chybí výkupní cena."],
    } satisfies Prisma.JsonObject;
    const failed = documentFixture({
      id: "failed",
      createdAt: new Date("2026-03-01T00:00:00Z"),
      extractedData: {},
      extractionVersion: INVOICE_AI_FAILED_MARKER,
    });
    const serialized = serializeCustomerInvoiceRequest({
      id: "request-1",
      energySiteId: 1,
      referenceCode: "FVE-1-TEST",
      contactEmail: "contact@spottex.cz",
      status: EnergyInvoiceRequestStatus.NEEDS_INPUT,
      receivedAt: new Date("2026-01-01T00:00:00Z"),
      processedAt: null,
      notes: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-03-01T00:00:00Z"),
      documents: [
        failed,
        documentFixture({ id: "newer", createdAt: new Date("2026-02-01T00:00:00Z"), extractedData: newerDraft, extractionVersion: "ai-codex-v2-draft-v2" }),
        documentFixture({ id: "older", createdAt: new Date("2026-01-01T00:00:00Z"), extractedData: olderDraft, extractionVersion: "ai-codex-v2-draft-v1" }),
      ],
    });

    expect(serialized?.combined.values).toMatchObject({
      distributionTariffCode: "D02d",
      currentSupplierName: "Novější dodavatel",
      currentProductName: "Produkt Plus",
      fixedBuyPriceCzkKwh: 3.2,
    });
    expect(serialized?.combined.conflicts).toContain("currentSupplierName");
    expect(serialized?.combined.sourceDocumentIds).toEqual(["newer", "older"]);
    expect(serialized?.documents[0]?.state).toBe("FAILED");
  });
});
