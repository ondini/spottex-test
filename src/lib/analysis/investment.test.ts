import { describe, expect, it } from "vitest";

import { calculateInvestmentAssessment } from "./investment";

describe("investment assessment", () => {
  it("caps a grant and includes APR financing cost in payback", () => {
    const result = calculateInvestmentAssessment({ capexCzk: 200_000, annualSavingsCzk: 20_000, grant: { subsidyRatePct: 50, maximumAmountCzk: 80_000, calculationFormula: {} }, loan: { principalCzk: 100_000, aprPct: 6, feesCzk: 1_000, minimumAmountCzk: 10_000, maximumAmountCzk: 150_000, termMonths: 60, termMonthsMin: 12, termMonthsMax: 120 } });
    expect(result.grantCzk).toBe(80_000);
    expect(result.totalFinancingCostCzk).toBeGreaterThan(16_000);
    expect(result.simplePaybackYears).toBeGreaterThan(6);
  });
});
