import { timeRulesFormulaSchema } from "./time-rules";

export type CatalogValidationIssue = {
  field: string;
  message: string;
  severity: "ERROR" | "WARNING";
};

export type CatalogPriceDiff = {
  field: string;
  previous: number;
  next: number;
  changePct: number | null;
};

export type CatalogValidationReport = {
  valid: boolean;
  issues: CatalogValidationIssue[];
  diffs: CatalogPriceDiff[];
};

type Source = {
  sourceUrl: string;
  contentSha256: string;
  rawText?: string | null;
  metadata?: unknown;
  status?: string;
};

type VersionBase = {
  validFrom: Date;
  validTo: Date | null;
  currency: string;
  vatIncluded: boolean;
  sourceDocument: Source | null;
};

export type FundingVersionForValidation = {
  kind: "GRANT" | "LOAN";
  validFrom: Date;
  validTo: Date | null;
  territoryCodes: string[];
  customerSegments: string[];
  supportedTechnologies: string[];
  minimumAmountCzk: number | null;
  maximumAmountCzk: number | null;
  subsidyRatePct: number | null;
  interestRatePct: number | null;
  aprPct: number | null;
  feesCzk: number | null;
  conditions: unknown;
  calculationFormula: unknown;
  sourceDocument: Source | null;
};

export type ProductVersionForValidation = VersionBase & {
  buyMode: "FIX" | "SPOT" | "TIME_CURVE";
  sellMode: "FIX" | "SPOT" | "TIME_CURVE";
  monthlyFeeCzk: number;
  fixedBuyVtCzkKwh: number | null;
  fixedBuyNtCzkKwh: number | null;
  fixedSellVtCzkKwh: number | null;
  fixedSellNtCzkKwh: number | null;
  spotBuyFeeCzkKwh: number | null;
  spotSellFeeCzkKwh: number | null;
  formula: unknown;
};

export type DistributionVersionForValidation = VersionBase & {
  distributionVtCzkKwh: number;
  distributionNtCzkKwh: number;
  systemServicesCzkKwh: number;
  electricityTaxCzkKwh: number;
  pozeCzkKwh: number;
  monthlyMeterFeeCzk: number;
  breakerFees: unknown;
};

const PRODUCT_FIELDS = [
  "monthlyFeeCzk",
  "fixedBuyVtCzkKwh",
  "fixedBuyNtCzkKwh",
  "fixedSellVtCzkKwh",
  "fixedSellNtCzkKwh",
  "spotBuyFeeCzkKwh",
  "spotSellFeeCzkKwh",
] as const;

const DISTRIBUTION_FIELDS = [
  "distributionVtCzkKwh",
  "distributionNtCzkKwh",
  "systemServicesCzkKwh",
  "electricityTaxCzkKwh",
  "pozeCzkKwh",
  "monthlyMeterFeeCzk",
] as const;

function object(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function validateBase(input: VersionBase): CatalogValidationIssue[] {
  const issues: CatalogValidationIssue[] = [];
  if (!Number.isFinite(input.validFrom.getTime()))
    issues.push({
      field: "validFrom",
      message: "Začátek platnosti není platné datum.",
      severity: "ERROR",
    });
  if (input.validTo && input.validTo <= input.validFrom)
    issues.push({
      field: "validTo",
      message: "Konec platnosti musí být po začátku.",
      severity: "ERROR",
    });
  if (input.currency !== "CZK")
    issues.push({
      field: "currency",
      message: "Výpočet zatím podporuje pouze CZK.",
      severity: "ERROR",
    });
  if (!input.vatIncluded)
    issues.push({
      field: "vatIncluded",
      message:
        "Cena je bez DPH. Do katalogu pro zákaznické výpočty lze publikovat až přepočtenou cenu včetně DPH.",
      severity: "ERROR",
    });
  if (!input.sourceDocument) {
    issues.push({
      field: "sourceDocumentId",
      message: "Chybí archivovaný zdrojový dokument.",
      severity: "ERROR",
    });
  } else {
    issues.push(...validateSourceDocument(input.sourceDocument).issues);
    if (
      !new Set(["VALIDATED", "PUBLISHED"]).has(
        input.sourceDocument.status ?? "",
      )
    ) {
      issues.push({
        field: "sourceDocument.status",
        message: "Zdrojový dokument musí nejdřív zkontrolovat administrátor.",
        severity: "ERROR",
      });
    }
  }
  return issues;
}

function bounded(
  issues: CatalogValidationIssue[],
  field: string,
  value: number | null,
  min: number,
  max: number,
  required = true,
) {
  if (value == null || !Number.isFinite(value)) {
    if (required)
      issues.push({
        field,
        message: "Povinná číselná hodnota chybí.",
        severity: "ERROR",
      });
    return;
  }
  if (value < min || value > max)
    issues.push({
      field,
      message: `Hodnota ${value} je mimo kontrolní rozsah ${min} až ${max}.`,
      severity: "ERROR",
    });
}

function priceDiffs<T extends Record<string, unknown>>(
  current: T,
  previous: T | null,
  fields: readonly (keyof T)[],
): CatalogPriceDiff[] {
  if (!previous) return [];
  return fields.flatMap((field) => {
    const next = current[field];
    const before = previous[field];
    if (
      typeof next !== "number" ||
      typeof before !== "number" ||
      next === before
    )
      return [];
    return [
      {
        field: String(field),
        previous: before,
        next,
        changePct:
          before === 0
            ? null
            : Math.round(((next - before) / Math.abs(before)) * 10_000) / 100,
      },
    ];
  });
}

function diffWarnings(diffs: CatalogPriceDiff[]): CatalogValidationIssue[] {
  return diffs
    .filter((diff) => diff.changePct == null || Math.abs(diff.changePct) >= 50)
    .map((diff) => ({
      field: diff.field,
      message: `Cena se proti předchozí verzi změnila o ${diff.changePct == null ? "nedefinovatelný poměr" : `${diff.changePct} %`}.`,
      severity: "WARNING" as const,
    }));
}

export function validateSourceDocument(
  source: Source,
): CatalogValidationReport {
  const issues: CatalogValidationIssue[] = [];
  try {
    const url = new URL(source.sourceUrl);
    if (url.protocol !== "https:") throw new Error();
  } catch {
    issues.push({
      field: "sourceUrl",
      message: "Zdroj musí být platná HTTPS adresa oficiálního dokumentu.",
      severity: "ERROR",
    });
  }
  if (!/^[a-f0-9]{64}$/i.test(source.contentSha256))
    issues.push({
      field: "contentSha256",
      message: "Chybí platný SHA-256 otisk zdroje.",
      severity: "ERROR",
    });
  const metadata = object(source.metadata);
  if (
    !source.rawText?.trim() &&
    typeof metadata.storageObject !== "string" &&
    typeof metadata.archivedUrl !== "string"
  ) {
    issues.push({
      field: "rawText",
      message:
        "Zdroj nemá archivovaný obsah ani odkaz na neměnnou uloženou kopii.",
      severity: "ERROR",
    });
  }
  return {
    valid: !issues.some((issue) => issue.severity === "ERROR"),
    issues,
    diffs: [],
  };
}

export function validateProductVersion(
  input: ProductVersionForValidation,
  previous: ProductVersionForValidation | null = null,
): CatalogValidationReport {
  const issues = validateBase(input);
  bounded(issues, "monthlyFeeCzk", input.monthlyFeeCzk, 0, 10_000);
  if (input.buyMode === "FIX") {
    bounded(issues, "fixedBuyVtCzkKwh", input.fixedBuyVtCzkKwh, -20, 50);
    bounded(issues, "fixedBuyNtCzkKwh", input.fixedBuyNtCzkKwh, -20, 50, false);
  } else if (input.buyMode === "SPOT")
    bounded(issues, "spotBuyFeeCzkKwh", input.spotBuyFeeCzkKwh, -5, 20);
  if (input.sellMode === "FIX") {
    bounded(issues, "fixedSellVtCzkKwh", input.fixedSellVtCzkKwh, -20, 50);
    bounded(
      issues,
      "fixedSellNtCzkKwh",
      input.fixedSellNtCzkKwh,
      -20,
      50,
      false,
    );
  } else if (input.sellMode === "SPOT")
    bounded(issues, "spotSellFeeCzkKwh", input.spotSellFeeCzkKwh, -5, 20);
  if ([input.buyMode, input.sellMode].includes("TIME_CURVE")) {
    const formula = timeRulesFormulaSchema.safeParse(input.formula);
    if (!formula.success)
      issues.push({
        field: "formula",
        message:
          "Nestandardní ceník musí používat podporovaný deklarativní generátor TIME_RULES_V1.",
        severity: "ERROR",
      });
    else {
      if (input.buyMode === "TIME_CURVE" && !formula.data.buy)
        issues.push({
          field: "formula.buy",
          message: "Chybí pravidla nákupní ceny.",
          severity: "ERROR",
        });
      if (input.sellMode === "TIME_CURVE" && !formula.data.sell)
        issues.push({
          field: "formula.sell",
          message: "Chybí pravidla výkupní ceny.",
          severity: "ERROR",
        });
    }
  }
  const diffs = priceDiffs(input, previous, PRODUCT_FIELDS);
  issues.push(...diffWarnings(diffs));
  return {
    valid: !issues.some((issue) => issue.severity === "ERROR"),
    issues,
    diffs,
  };
}

export function validateDistributionVersion(
  input: DistributionVersionForValidation,
  previous: DistributionVersionForValidation | null = null,
): CatalogValidationReport {
  const issues = validateBase(input);
  for (const field of DISTRIBUTION_FIELDS)
    bounded(
      issues,
      field,
      input[field],
      0,
      field === "monthlyMeterFeeCzk" ? 10_000 : 50,
    );
  if (Object.keys(object(input.breakerFees)).length === 0)
    issues.push({
      field: "breakerFees",
      message: "Chybí tabulka plateb podle jističe.",
      severity: "ERROR",
    });
  const diffs = priceDiffs(input, previous, DISTRIBUTION_FIELDS);
  issues.push(...diffWarnings(diffs));
  return {
    valid: !issues.some((issue) => issue.severity === "ERROR"),
    issues,
    diffs,
  };
}

export function validateFundingVersion(
  input: FundingVersionForValidation,
): CatalogValidationReport {
  const issues: CatalogValidationIssue[] = [];
  if (!Number.isFinite(input.validFrom.getTime()))
    issues.push({
      field: "validFrom",
      message: "Začátek platnosti není platné datum.",
      severity: "ERROR",
    });
  if (input.validTo && input.validTo <= input.validFrom)
    issues.push({
      field: "validTo",
      message: "Konec platnosti musí být po začátku.",
      severity: "ERROR",
    });
  if (!input.sourceDocument)
    issues.push({
      field: "sourceDocumentId",
      message: "Chybí archivovaný oficiální zdroj.",
      severity: "ERROR",
    });
  else {
    issues.push(...validateSourceDocument(input.sourceDocument).issues);
    if (
      !new Set(["VALIDATED", "PUBLISHED"]).has(
        input.sourceDocument.status ?? "",
      )
    )
      issues.push({
        field: "sourceDocument.status",
        message: "Zdroj musí nejdřív zkontrolovat administrátor.",
        severity: "ERROR",
      });
  }
  if (!input.customerSegments.length)
    issues.push({
      field: "customerSegments",
      message: "Chybí skupina oprávněných žadatelů.",
      severity: "ERROR",
    });
  if (!input.supportedTechnologies.length)
    issues.push({
      field: "supportedTechnologies",
      message: "Chybí podporované technologie.",
      severity: "ERROR",
    });
  if (!input.territoryCodes.length)
    issues.push({
      field: "territoryCodes",
      message: "Územní působnost není výslovně uvedená.",
      severity: "ERROR",
    });
  if (!Object.keys(object(input.conditions)).length)
    issues.push({
      field: "conditions",
      message: "Chybí technické, příjmové nebo časové podmínky programu.",
      severity: "ERROR",
    });
  bounded(
    issues,
    "minimumAmountCzk",
    input.minimumAmountCzk,
    0,
    100_000_000,
    false,
  );
  bounded(
    issues,
    "maximumAmountCzk",
    input.maximumAmountCzk,
    0,
    100_000_000,
    false,
  );
  if (
    input.minimumAmountCzk != null &&
    input.maximumAmountCzk != null &&
    input.minimumAmountCzk > input.maximumAmountCzk
  )
    issues.push({
      field: "maximumAmountCzk",
      message: "Maximum je nižší než minimum.",
      severity: "ERROR",
    });
  if (input.kind === "GRANT") {
    const conditions = object(input.conditions);
    for (const field of ["territory", "technical", "applicants", "timing"])
      if (!(field in conditions))
        issues.push({
          field: `conditions.${field}`,
          message:
            "Dotační titul musí tuto podmínku uvést výslovně, případně jako nepoužitelnou.",
          severity: "ERROR",
        });
    bounded(issues, "subsidyRatePct", input.subsidyRatePct, 0, 100, false);
    const formula = object(input.calculationFormula);
    const supportedFixedFormula =
      formula.mode === "FIXED_CZK" &&
      typeof formula.amountCzk === "number" &&
      Number.isFinite(formula.amountCzk) &&
      formula.amountCzk >= 0;
    if (input.subsidyRatePct == null && !supportedFixedFormula)
      issues.push({
        field: "calculationFormula",
        message:
          "Dotace nemá bezpečně vyčíslitelnou procentní výši ani podporovaný vzorec FIXED_CZK.",
        severity: "ERROR",
      });
  } else {
    bounded(issues, "aprPct", input.aprPct, 0, 200);
    bounded(issues, "interestRatePct", input.interestRatePct, 0, 100, false);
    bounded(issues, "feesCzk", input.feesCzk, 0, 10_000_000, false);
    const conditions = object(input.conditions);
    if (
      typeof conditions.termMonthsMin !== "number" ||
      typeof conditions.termMonthsMax !== "number"
    )
      issues.push({
        field: "conditions.termMonths",
        message:
          "Financování musí uvádět minimální a maximální dobu splatnosti.",
        severity: "ERROR",
      });
  }
  return {
    valid: !issues.some((issue) => issue.severity === "ERROR"),
    issues,
    diffs: [],
  };
}
