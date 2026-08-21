import { describe, expect, it } from "vitest";

import { invoiceAiDraftSchema } from "./invoice-ai";

const values = {
  ean: null,
  address: null,
  distributorCode: null,
  distributionTariffCode: "D25d",
  phases: 3,
  mainFuseA: 25,
  buyPricingMode: "FIX" as const,
  sellPricingMode: "FIX" as const,
  currentSupplierName: "Dodavatel",
  currentProductName: "Produkt",
  monthlySupplierFeeCzk: 120,
  fixedBuyPriceCzkKwh: 3.5,
  fixedSellPriceCzkKwh: 1,
  spotBuyFeeCzkKwh: null,
  spotSellFeeCzkKwh: null,
  fixedPriceValidUntil: "2027-01-01",
  hdoStatus: "MISSING" as const,
};

describe("invoice AI draft", () => {
  it("accepts a complete review-only proposal", () => {
    expect(
      invoiceAiDraftSchema.parse({
        schemaVersion: "energy-invoice-ai-v1",
        billingPeriodFrom: "2026-01-01",
        billingPeriodTo: "2026-02-01",
        values,
        fieldEvidence: [
          { field: "mainFuseA", confidence: "HIGH", evidence: "3×25 A" },
        ],
        warnings: [],
      }).values.mainFuseA,
    ).toBe(25);
  });

  it("accepts the current parser schema revision", () => {
    expect(invoiceAiDraftSchema.safeParse({
      schemaVersion: "energy-invoice-ai-v2",
      billingPeriodFrom: "2026-01-01",
      billingPeriodTo: "2026-02-01",
      values,
      fieldEvidence: [],
      warnings: [],
    }).success).toBe(true);
  });

  it("rejects an inverted billing period and unknown fields", () => {
    expect(
      invoiceAiDraftSchema.safeParse({
        schemaVersion: "energy-invoice-ai-v1",
        billingPeriodFrom: "2026-02-01",
        billingPeriodTo: "2026-01-01",
        values: { ...values, inventedPrice: 4 },
        fieldEvidence: [],
        warnings: [],
      }).success,
    ).toBe(false);
  });
});
