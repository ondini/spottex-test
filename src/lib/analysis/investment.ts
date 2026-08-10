export type GrantTerms = {
  subsidyRatePct: number | null;
  maximumAmountCzk: number | null;
  calculationFormula: unknown;
};

export type LoanTerms = {
  aprPct: number;
  feesCzk: number;
  minimumAmountCzk: number | null;
  maximumAmountCzk: number | null;
  termMonthsMin: number;
  termMonthsMax: number;
};

function object(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateGrantCzk(capexCzk: number, terms: GrantTerms | null) {
  if (!terms) return 0;
  const formula = object(terms.calculationFormula);
  const fixed =
    formula.mode === "FIXED_CZK" && typeof formula.amountCzk === "number"
      ? formula.amountCzk
      : null;
  const proportional =
    terms.subsidyRatePct == null
      ? null
      : (capexCzk * terms.subsidyRatePct) / 100;
  const raw = fixed ?? proportional ?? 0;
  return round(
    Math.max(
      0,
      Math.min(
        capexCzk,
        terms.maximumAmountCzk == null
          ? raw
          : Math.min(raw, terms.maximumAmountCzk),
      ),
    ),
  );
}

export function calculateInvestmentAssessment(input: {
  capexCzk: number;
  annualSavingsCzk: number;
  grant: GrantTerms | null;
  loan: (LoanTerms & { principalCzk: number; termMonths: number }) | null;
}) {
  if (!Number.isFinite(input.capexCzk) || input.capexCzk < 0)
    throw new Error("INVESTMENT_CAPEX_INVALID");
  const grantCzk = calculateGrantCzk(input.capexCzk, input.grant);
  const netInvestmentCzk = Math.max(0, input.capexCzk - grantCzk);
  let principalCzk = 0;
  let monthlyPaymentCzk = 0;
  let totalFinancingCostCzk = 0;
  if (input.loan) {
    if (
      input.loan.termMonths < input.loan.termMonthsMin ||
      input.loan.termMonths > input.loan.termMonthsMax
    )
      throw new Error("INVESTMENT_LOAN_TERM_INVALID");
    principalCzk = Math.min(
      netInvestmentCzk,
      input.loan.maximumAmountCzk ?? Number.POSITIVE_INFINITY,
      input.loan.principalCzk,
    );
    if (
      input.loan.minimumAmountCzk != null &&
      principalCzk < input.loan.minimumAmountCzk
    )
      throw new Error("INVESTMENT_LOAN_AMOUNT_INVALID");
    const monthlyRate = input.loan.aprPct / 100 / 12;
    monthlyPaymentCzk =
      monthlyRate === 0
        ? principalCzk / input.loan.termMonths
        : (principalCzk * monthlyRate) /
          (1 - (1 + monthlyRate) ** -input.loan.termMonths);
    totalFinancingCostCzk =
      monthlyPaymentCzk * input.loan.termMonths -
      principalCzk +
      input.loan.feesCzk;
  }
  const effectiveInvestmentCzk = netInvestmentCzk + totalFinancingCostCzk;
  const annualSavingsCzk = Math.max(0, input.annualSavingsCzk);
  return {
    capexCzk: round(input.capexCzk),
    grantCzk,
    netInvestmentCzk: round(netInvestmentCzk),
    loanPrincipalCzk: round(principalCzk),
    monthlyPaymentCzk: round(monthlyPaymentCzk),
    totalFinancingCostCzk: round(totalFinancingCostCzk),
    effectiveInvestmentCzk: round(effectiveInvestmentCzk),
    annualSavingsCzk: round(annualSavingsCzk),
    simplePaybackYears:
      annualSavingsCzk > 0
        ? round(effectiveInvestmentCzk / annualSavingsCzk)
        : null,
    method: "SIMPLE_PAYBACK_WITH_PUBLISHED_GRANT_AND_APR_V1",
  };
}
