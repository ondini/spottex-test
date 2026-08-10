import { describe, expect, it } from "vitest";

import {
  validateDistributionVersion,
  validateFundingVersion,
  validateProductVersion,
  validateSourceDocument,
} from "./catalog-validation";

const source = {
  sourceUrl: "https://www.example-energy.cz/cenik.pdf",
  contentSha256: "a".repeat(64),
  rawText: "Archivovaný obsah ceníku",
  status: "VALIDATED",
};

const fixed = {
  validFrom: new Date("2026-01-01T00:00:00Z"),
  validTo: new Date("2027-01-01T00:00:00Z"),
  currency: "CZK",
  vatIncluded: true,
  sourceDocument: source,
  buyMode: "FIX" as const,
  sellMode: "FIX" as const,
  monthlyFeeCzk: 120,
  fixedBuyVtCzkKwh: 3.4,
  fixedBuyNtCzkKwh: 3.1,
  fixedSellVtCzkKwh: 1.2,
  fixedSellNtCzkKwh: 1.2,
  spotBuyFeeCzkKwh: null,
  spotSellFeeCzkKwh: null,
  formula: {},
};

describe("catalog validation", () => {
  it("refuses a source without an immutable archived copy", () => {
    const report = validateSourceDocument({ ...source, rawText: null });
    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.field)).toContain("rawText");
  });

  it("accepts a complete fixed product and highlights a large version diff", () => {
    expect(validateProductVersion(fixed).valid).toBe(true);
    const report = validateProductVersion(
      { ...fixed, fixedBuyVtCzkKwh: 6 },
      fixed,
    );
    expect(report.valid).toBe(true);
    expect(report.diffs).toContainEqual(
      expect.objectContaining({ field: "fixedBuyVtCzkKwh", changePct: 76.47 }),
    );
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        field: "fixedBuyVtCzkKwh",
        severity: "WARNING",
      }),
    );
  });

  it("requires an audited generator for a custom time curve", () => {
    const report = validateProductVersion({
      ...fixed,
      buyMode: "TIME_CURVE",
      formula: {},
    });
    expect(report.valid).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({ field: "formula" }),
    );
  });

  it("requires breaker prices for a distribution version", () => {
    const report = validateDistributionVersion({
      validFrom: fixed.validFrom,
      validTo: fixed.validTo,
      currency: "CZK",
      vatIncluded: true,
      sourceDocument: source,
      distributionVtCzkKwh: 2,
      distributionNtCzkKwh: 0.3,
      systemServicesCzkKwh: 0.2,
      electricityTaxCzkKwh: 0.03,
      pozeCzkKwh: 0.5,
      monthlyMeterFeeCzk: 30,
      breakerFees: {},
    });
    expect(report.valid).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({ field: "breakerFees" }),
    );
  });

  it("requires explicit grant eligibility dimensions and a calculable benefit", () => {
    const report = validateFundingVersion({
      kind: "GRANT",
      validFrom: fixed.validFrom,
      validTo: fixed.validTo,
      territoryCodes: ["CZ"],
      customerSegments: ["HOUSEHOLD"],
      supportedTechnologies: ["FVE", "BATTERY"],
      minimumAmountCzk: null,
      maximumAmountCzk: 140_000,
      subsidyRatePct: 30,
      interestRatePct: null,
      aprPct: null,
      feesCzk: null,
      conditions: {
        territory: "ČR",
        technical: "FVE s akumulací",
        applicants: "vlastník domu",
        timing: "před ukončením výzvy",
      },
      calculationFormula: {},
      sourceDocument: source,
    });
    expect(report.valid).toBe(true);
    expect(
      validateFundingVersion({ ...reportFixture("GRANT"), territoryCodes: [] })
        .valid,
    ).toBe(false);
  });

  it("does not publish financing without APR and an explicit term range", () => {
    const report = validateFundingVersion({
      ...reportFixture("LOAN"),
      aprPct: null,
      conditions: { eligibility: "HOUSEHOLD" },
    });
    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining(["aprPct", "conditions.termMonths"]),
    );
  });
});

function reportFixture(kind: "GRANT" | "LOAN") {
  return {
    kind,
    validFrom: fixed.validFrom,
    validTo: fixed.validTo,
    territoryCodes: ["CZ"],
    customerSegments: ["HOUSEHOLD"],
    supportedTechnologies: ["FVE"],
    minimumAmountCzk: 10_000,
    maximumAmountCzk: 1_000_000,
    subsidyRatePct: kind === "GRANT" ? 30 : null,
    interestRatePct: kind === "LOAN" ? 5 : null,
    aprPct: kind === "LOAN" ? 6 : null,
    feesCzk: kind === "LOAN" ? 1_000 : null,
    conditions: { termMonthsMin: 12, termMonthsMax: 120 },
    calculationFormula: {},
    sourceDocument: source,
  };
}
