import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { EnergyIntervalKind, JobStatus, Prisma } from "@prisma/client";
import { z } from "zod";

import { queueEmail } from "@/lib/email";
import { getCostsCatalogSummary } from "@/lib/costs/client";
import { getEnergyDataQuality } from "@/lib/energy/data-quality";
import { prepareAnalysisDefaults } from "@/lib/energy/technical-profile";
import { prisma } from "@/lib/prisma";
import { calculateAnnualControlOffer } from "@/lib/commerce/service-offer";
import {
  breakerMonthlyFee,
  ensurePublishedCatalogCurvesForSite,
} from "@/lib/pricing/materialize";
import { ensureOteMarketCoverage } from "@/lib/pricing/market-sync";
import { supplierFulfillment } from "@/lib/pricing/supplier-mode";

import {
  simulateSelfUse,
  type AnalysisDispatchPoint,
  type AnalysisDispatchResult,
} from "./dispatch";
import { selectForecastPolicy, type ForecastSelection } from "./forecast";
import {
  DEFAULT_BATTERY_CYCLE_COST_CZK_KWH,
  MILP_ENGINE_VERSION,
} from "./milp";
import {
  ROLLING_MILP_METHOD_VERSION,
  simulateRollingMilp,
} from "./rolling-milp";
import {
  applyHdoExtreme,
  modeledHdoDefinition,
  type HdoSensitivityPricePoint,
} from "./hdo-sensitivity";
import {
  aggregateSiteIntervals,
  deriveIndependentLoadProfile,
} from "./load-profile";
import { calculateInvestmentAssessment } from "./investment";
import { selectAnalysisCurveIds } from "./curve-selection";
import {
  hasMaterialUnservedEnergy,
  unservedEnergyToleranceKwh,
} from "./eligibility";
import {
  calculateProAnalysisPriceMinor,
  PRO_ALL_TARIFFS_PRICE_MINOR,
  PRO_EXTRA_POINT_PRICE_MINOR,
} from "./pro-pricing";

export const ENERGY_ANALYSIS_JOB = "ENERGY_ANALYSIS_V2";
export const ENERGY_ANALYSIS_PREPARE_JOB = "ENERGY_ANALYSIS_PREPARE_V1";
export const ANALYSIS_ENGINE_VERSION = MILP_ENGINE_VERSION;
export const ANALYSIS_METHODOLOGY_VERSION = `SELF_USE_VS_${ROLLING_MILP_METHOD_VERSION}`;
export const ANALYSIS_PRODUCTION_READY = true;
const ANALYSIS_FORECAST_WARMUP_DAYS = 28;
const ANALYSIS_SCENARIO_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.ANALYSIS_SCENARIO_TIMEOUT_MS ?? 600_000),
);
const ANALYSIS_MAX_SOLVER_CALLS = Math.max(
  50,
  Number(process.env.ANALYSIS_MAX_SOLVER_CALLS ?? 600),
);
const ANALYSIS_MAX_ATTEMPTS = 3;
const ANALYSIS_STALE_LOCK_MS = Math.max(
  15 * 60_000,
  Number(process.env.ANALYSIS_STALE_LOCK_MS ?? 60 * 60_000),
);
const ANALYSIS_RUN_BUDGET_MS = Math.max(
  60_000,
  Number(process.env.ANALYSIS_RUN_BUDGET_MS ?? 45 * 60_000),
);
const ANALYSIS_MAX_CONCURRENT_JOBS = Math.min(
  4,
  Math.max(1, Number(process.env.ANALYSIS_MAX_CONCURRENT_JOBS ?? 1)),
);
const ANALYSIS_JOB_BATCH_LIMIT = Math.min(
  3,
  Math.max(1, Number(process.env.ANALYSIS_JOB_BATCH_LIMIT ?? 1)),
);
const NON_RETRYABLE_ANALYSIS_ERRORS = new Set([
  "ANALYSIS_CANCELED",
  "ANALYSIS_PRICE_CURVE_DEFINITION_MISSING",
  "ANALYSIS_RUN_INVALID",
  "ANALYSIS_PROFILE_INCOMPLETE",
  "ANALYSIS_FUNDING_VERSION_INVALID",
]);

function terminalAnalysisMessage(code: string) {
  if (code === "ANALYSIS_PRICE_CURVE_DEFINITION_MISSING")
    return "Cenový scénář výpočtu byl neúplný. Obnovte stránku a spusťte výpočet znovu.";
  if (code === "ANALYSIS_SCENARIO_TIMEOUT")
    return "Jeden scénář překročil bezpečný časový limit.";
  return "Analýzu nelze dokončit bez úplných naměřených dat a ověřených cen pro každý interval.";
}

const hardwareSchema = z
  .object({
    batteryCapacityKwh: z.number().min(0).max(5_000),
    batteryMaxChargeKw: z.number().min(0).max(5_000).nullable().optional(),
    batteryMaxDischargeKw: z.number().min(0).max(5_000).nullable().optional(),
    pvCapacityKwp: z.number().min(0).max(10_000),
    maxGridInputKw: z.number().min(0).max(10_000).nullable().optional(),
    maxGridOutputKw: z.number().min(0).max(10_000).nullable().optional(),
    mainFuseA: z.number().min(1).max(1_000).nullable().optional(),
  })
  .strict();

export const analysisRequestSchema = z
  .object({
    siteId: z.number().int().positive(),
    kind: z.enum(["BASE", "PRO"]).default("BASE"),
    hardwareVariants: z.array(hardwareSchema).max(5_000).default([]),
    compareAllTariffs: z.boolean().default(false),
    selectedPriceCurveIds: z.array(z.string().min(1)).max(100).default([]),
    investment: z
      .object({
        capexCzk: z.number().min(0).max(1_000_000_000),
        grantVersionId: z.number().int().positive().nullable().default(null),
        loanVersionId: z.number().int().positive().nullable().default(null),
        financedAmountCzk: z
          .number()
          .min(0)
          .max(1_000_000_000)
          .nullable()
          .default(null),
        termMonths: z.number().int().min(1).max(600).nullable().default(null),
        eligibilityConfirmed: z.literal(true),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === "BASE" && value.hardwareVariants.length) {
      context.addIssue({
        code: "custom",
        path: ["hardwareVariants"],
        message: "Základní analýza používá pouze současnou elektrárnu.",
      });
    }
    if (value.kind === "BASE" && value.investment)
      context.addIssue({
        code: "custom",
        path: ["investment"],
        message: "Investiční návratnost je pouze součástí Pro analýzy.",
      });
    if (value.kind === "BASE" && value.compareAllTariffs)
      context.addIssue({
        code: "custom",
        path: ["compareAllTariffs"],
        message: "Úplný katalog ceníků je součástí Pro analýzy.",
      });
    if (
      value.investment?.loanVersionId &&
      (value.investment.financedAmountCzk == null ||
        value.investment.termMonths == null)
    )
      context.addIssue({
        code: "custom",
        path: ["investment"],
        message: "U financování chybí částka nebo doba splatnosti.",
      });
  });

const payloadSchema = z
  .object({ version: z.literal(2), analysisRunId: z.string().min(1) })
  .strict();

const analysisPreparationPayloadSchema = z.object({
  version: z.literal(1),
  userId: z.number().int().positive(),
  request: analysisRequestSchema,
});

function number(
  value: Prisma.Decimal | number | null | undefined,
  fallback = 0,
) {
  if (value == null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: Prisma.Decimal | number | null | undefined) {
  return value == null ? null : number(value);
}

function object(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function curveLabel(curve: {
  purpose: string;
  assumptions?: Prisma.JsonValue;
  buyProductVersion: null | {
    product: { name: string; supplier: { name: string } };
  };
  distributionVersion: null | { distributionTariff: { code: string } };
}) {
  const currentInput = object(curve.assumptions ?? {});
  const currentPriceInput = object(
    (currentInput.priceInput ?? {}) as Prisma.JsonValue,
  );
  const modeledLabel =
    typeof currentInput.label === "string" ? currentInput.label : null;
  const product =
    curve.purpose === "CURRENT_BASELINE"
      ? [
          "Váš současný produkt",
          currentPriceInput.supplier,
          currentPriceInput.product,
        ]
          .filter((value) => typeof value === "string" && value)
          .join(" · ")
      : curve.buyProductVersion
        ? `${curve.buyProductVersion.product.supplier.name} · ${curve.buyProductVersion.product.name}`
        : modeledLabel ?? curve.purpose;
  return [product, curve.distributionVersion?.distributionTariff.code]
    .filter(Boolean)
    .join(" · ");
}

function forecastSummary(value: unknown) {
  const root = object(value as Prisma.JsonValue);
  const summary = (signal: unknown) => {
    const source = object(signal as Prisma.JsonValue);
    const selected =
      typeof source.selected === "string" ? source.selected : null;
    const metrics = Array.isArray(source.metrics)
      ? source.metrics.map((item) => object(item as Prisma.JsonValue))
      : [];
    const metric = metrics.find((item) => item.method === selected);
    return {
      selected,
      normalizedMaePct:
        typeof metric?.normalizedMaePct === "number"
          ? metric.normalizedMaePct
          : null,
      coveragePct:
        typeof metric?.coveragePct === "number" ? metric.coveragePct : null,
    };
  };
  if (!Object.keys(root).length) return null;
  return {
    consumption: summary(root.consumption),
    production: summary(root.production),
    neuralCandidate: String(root.neuralCandidate ?? "NOT_CONFIGURED"),
  };
}

function investmentSummary(value: unknown) {
  const source = object(value as Prisma.JsonValue);
  if (!Object.keys(source).length) return null;
  const grantCzk = source.grantCzk;
  const effectiveInvestmentCzk = source.effectiveInvestmentCzk;
  const monthlyPaymentCzk = source.monthlyPaymentCzk;
  const simplePaybackYears = source.simplePaybackYears;
  if (
    typeof grantCzk !== "number" ||
    typeof effectiveInvestmentCzk !== "number" ||
    typeof monthlyPaymentCzk !== "number"
  )
    return null;
  return {
    grantCzk,
    effectiveInvestmentCzk,
    monthlyPaymentCzk,
    simplePaybackYears:
      typeof simplePaybackYears === "number" ? simplePaybackYears : null,
  };
}

function fusePowerKw(
  phases: number | null | undefined,
  amperes: number | null | undefined,
) {
  if (!phases || !amperes) return null;
  const apparentKw =
    phases === 3
      ? (Math.sqrt(3) * 400 * amperes) / 1_000
      : (230 * amperes) / 1_000;
  return Math.round(apparentKw * 0.95 * 1_000) / 1_000;
}

function availableBreakerAmperes(
  breakerFees: Prisma.JsonValue,
  phases: number | null | undefined,
) {
  if (!phases) return [];
  const table = object(breakerFees);
  const direct = Object.keys(table).flatMap((key) => {
    const match = key.replace("×", "x").match(/^(\d+)x([\d.]+)$/);
    return match && Number(match[1]) === phases ? [Number(match[2])] : [];
  });
  const nested = Object.keys(
    object((table[String(phases)] ?? null) as Prisma.JsonValue),
  ).map(Number);
  return [
    ...new Set(
      [...direct, ...nested].filter(
        (value) => Number.isFinite(value) && value > 0,
      ),
    ),
  ].sort((left, right) => left - right);
}

export async function getAnalysisWorkspace(
  userId: number,
  requestedSiteId?: number,
) {
  const siteIds = await prisma.energySite.findMany({
    where: { userId, inverters: { some: {} } },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  const selectedSiteId = siteIds.some((site) => site.id === requestedSiteId)
    ? requestedSiteId
    : siteIds[0]?.id;
  if (selectedSiteId) {
    // Page rendering must not wait for remote catalog refreshes. The scheduled
    // catalog jobs keep these defaults current; an analysis start performs its
    // own final validation before it creates scenarios.
    await prepareAnalysisDefaults(userId, selectedSiteId, {
      refreshRemote: false,
    });
  }
  const sites = await prisma.energySite.findMany({
    where: {
      userId,
      inverters: { some: {} },
      ...(selectedSiteId ? { id: selectedSiteId } : {}),
    },
    orderBy: { id: "asc" },
    include: {
      technicalProfile: true,
      priceCurves: {
        where: { status: "READY" },
        orderBy: { createdAt: "desc" },
        include: {
          buyProductVersion: {
            include: { product: { include: { supplier: true } } },
          },
          sellProductVersion: {
            include: { product: { include: { supplier: true } } },
          },
          distributionVersion: { include: { distributionTariff: true } },
        },
      },
      analysisRuns: {
        where: { status: { not: "SUPERSEDED" } },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          scenarios: {
            orderBy: { scenarioKey: "asc" },
            include: {
              priceCurve: {
                include: {
                  buyProductVersion: {
                    include: { product: { include: { supplier: true } } },
                  },
                  sellProductVersion: {
                    include: { product: { include: { supplier: true } } },
                  },
                  distributionVersion: {
                    include: { distributionTariff: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  const quality = new Map(
    await Promise.all(
      sites.map(
        async (site) =>
          [site.id, await getEnergyDataQuality(userId, site.id)] as const,
      ),
    ),
  );
  const [
    fundingVersions,
    publishedProductVersions,
    publishedDistributionVersions,
    costsCatalog,
    preparationJobs,
    runningHistoryImports,
  ] = await Promise.all([
    prisma.fundingProgramVersion.findMany({
      where: {
        status: "PUBLISHED",
        validFrom: { lte: new Date() },
        OR: [{ validTo: null }, { validTo: { gt: new Date() } }],
        fundingProgram: { active: true },
      },
      include: { fundingProgram: true },
      orderBy: [
        { fundingProgram: { kind: "asc" } },
        { fundingProgram: { name: "asc" } },
      ],
    }),
    prisma.energyProductVersion.count({ where: { status: "PUBLISHED" } }),
    prisma.distributionTariffVersion.count({ where: { status: "PUBLISHED" } }),
    getCostsCatalogSummary(["ENERGY_SUPPLY", "ENERGY_DISTRIBUTION"]),
    prisma.scheduledJob.findMany({
      where: {
        type: ENERGY_ANALYSIS_PREPARE_JOB,
        status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
        payload: { path: ["userId"], equals: userId },
      },
      orderBy: { createdAt: "desc" },
      take: Math.max(10, siteIds.length * 2),
      select: { payload: true },
    }),
    // A site whose history is still arriving is not waiting on the user. The
    // overview has to be able to say so instead of listing the gap as
    // something they have to go and fix.
    prisma.energyHistoryImport.findMany({
      where: {
        energySiteId: { in: siteIds.map((site) => site.id) },
        status: { in: ["QUEUED", "RUNNING"] },
      },
      orderBy: { createdAt: "desc" },
      select: {
        energySiteId: true,
        status: true,
        totalChunks: true,
        succeededChunks: true,
        failedChunks: true,
        importedPoints: true,
      },
    }),
  ]);
  const preparingSiteIds = new Set(
    preparationJobs.flatMap((job) => {
      const parsed = analysisPreparationPayloadSchema.safeParse(job.payload);
      return parsed.success && parsed.data.userId === userId
        ? [parsed.data.request.siteId]
        : [];
    }),
  );
  const historyImportBySite = new Map(
    runningHistoryImports.map((run) => [run.energySiteId, run] as const),
  );
  const standardCatalogReady = publishedProductVersions > 0 && publishedDistributionVersions > 0;
  return {
    engine: {
      version: ANALYSIS_ENGINE_VERSION,
      productionReady: ANALYSIS_PRODUCTION_READY,
      message:
        "Self-use se počítá fyzikální simulací a smart varianta používá 15minutový dispatch, hodinový plán a rolling MILP s 34hodinovým výhledem. U dlouhého ročního backtestu se četnost přeplánování adaptivně omezuje, aby byl výpočet dokončitelný. Jádro prošlo křížovou regresí proti Studii i roční fyzikální a kapacitní validací; výsledek je modelovaný odhad, ne záruka budoucí úspory.",
    },
    supplierFulfillment: supplierFulfillment(),
    costsCatalog,
    catalogStats: {
      productVersions: publishedProductVersions,
      distributionVersions: publishedDistributionVersions,
    },
    fundingPrograms: fundingVersions.map((version) => ({
      id: version.id,
      kind: version.fundingProgram.kind,
      name: version.fundingProgram.name,
      providerName: version.fundingProgram.providerName,
      officialUrl: version.fundingProgram.officialUrl,
      validFrom: version.validFrom.toISOString(),
      validTo: version.validTo?.toISOString() ?? null,
      territoryCodes: version.territoryCodes,
      customerSegments: version.customerSegments,
      supportedTechnologies: version.supportedTechnologies,
      minimumAmountCzk: nullableNumber(version.minimumAmountCzk),
      maximumAmountCzk: nullableNumber(version.maximumAmountCzk),
      subsidyRatePct: nullableNumber(version.subsidyRatePct),
      aprPct: nullableNumber(version.aprPct),
      feesCzk: nullableNumber(version.feesCzk),
      conditions: version.conditions,
    })),
    sites: sites.map((site) => {
      const dataQuality = quality.get(site.id)!;
      const profile = site.technicalProfile;
      const dataFrom = dataQuality.from ? new Date(dataQuality.from) : null;
      const dataTo = dataQuality.to
        ? new Date(new Date(dataQuality.to).getTime() + 15 * 60_000)
        : null;
      const eligibleCurves =
        dataFrom && dataTo
          ? site.priceCurves.filter(
              (curve) =>
                curve.validFrom <= dataFrom &&
                curve.validTo >= dataTo &&
                (curve.buyProductVersion?.product.active ?? true) &&
                (curve.distributionVersion?.distributionTariff.active ?? true),
            )
          : [];
      const blockers = [
        ...(!dataQuality.readyForEstimate ? [dataQuality.message] : []),
      ];
      const historyImport = historyImportBySite.get(site.id);
      return {
        id: site.id,
        name: site.name,
        preparing: preparingSiteIds.has(site.id),
        historyImport: historyImport
          ? {
              totalChunks: historyImport.totalChunks,
              doneChunks: Math.min(
                historyImport.totalChunks,
                historyImport.succeededChunks + historyImport.failedChunks,
              ),
              importedPoints: historyImport.importedPoints,
            }
          : null,
        dataQuality,
        ready: blockers.length === 0,
        blockers,
        profileConfirmed: Boolean(profile),
        standardCatalogReady,
        currentHardware: {
          batteryCapacityKwh: profile?.batteryCapacityKwh ?? null,
          batteryMaxChargeKw:
            profile?.batteryMaxChargeKw ??
            (profile?.batteryCapacityKwh != null
              ? profile.batteryCapacityKwh * 0.5
              : null),
          batteryMaxDischargeKw:
            profile?.batteryMaxDischargeKw ??
            (profile?.batteryCapacityKwh != null
              ? profile.batteryCapacityKwh * 0.5
              : null),
          pvCapacityKwp: profile?.pvCapacityKwp ?? null,
          maxGridInputKw: profile?.maxGridInputKw ?? null,
          maxGridOutputKw: profile?.maxGridOutputKw ?? null,
          phases: profile?.phases ?? null,
          mainFuseA: profile?.mainFuseA ?? null,
          availableMainFuseA: [
            ...new Set(
              eligibleCurves.flatMap((curve) =>
                availableBreakerAmperes(
                  curve.distributionVersion?.breakerFees ?? {},
                  profile?.phases,
                ),
              ),
            ),
          ].sort((left, right) => left - right),
        },
        priceCurves: eligibleCurves.map((curve) => ({
          id: curve.id,
          label: curveLabel(curve),
          purpose: curve.purpose,
          modeled: object(curve.assumptions).source === "MODELED_DEFAULT",
          sourceUrl:
            typeof object(curve.assumptions).sourceUrl === "string" &&
            String(object(curve.assumptions).sourceUrl).startsWith("https://")
              ? String(object(curve.assumptions).sourceUrl)
              : null,
          validFrom: curve.validFrom.toISOString(),
          validTo: curve.validTo.toISOString(),
        })),
        runs: site.analysisRuns.map((run) => ({
          id: run.id,
          status: run.status,
          kind: run.kind,
          engineVersion: run.engineVersion,
          confidence: run.confidence,
          createdAt: run.createdAt.toISOString(),
          completedAt: run.completedAt?.toISOString() ?? null,
          dataFrom: run.dataFrom?.toISOString() ?? null,
          dataTo: run.dataTo?.toISOString() ?? null,
          proPriceMinor: run.proPriceMinor,
          billablePointCount: run.billablePointCount,
          compareAllTariffs: object(run.inputs).compareAllTariffs === true,
          errorMessage: run.errorMessage,
          forecastQuality: forecastSummary(
            object(run.assumptions).forecastQuality,
          ),
          loadProfileMethod: String(
            object(object(run.assumptions).loadProfile as Prisma.JsonValue)
              .method ?? "",
          ),
          progress: {
            completed: run.scenarios.filter(
              (scenario) =>
                scenario.status === "COMPLETED" ||
                scenario.status === "INELIGIBLE",
            ).length,
            total: run.scenarios.length,
          },
          scenarios: run.scenarios.map((scenario) => ({
            id: scenario.id,
            priceCurveId: scenario.priceCurveId,
            key: scenario.scenarioKey,
            label: scenario.label,
            status: scenario.status,
            controlMode: scenario.controlMode,
            annualCostCzk: nullableNumber(scenario.annualCostCzk),
            annualCostLowerCzk: nullableNumber(scenario.annualCostLowerCzk),
            annualCostUpperCzk: nullableNumber(scenario.annualCostUpperCzk),
            annualImportCostCzk: nullableNumber(scenario.annualImportCostCzk),
            annualExportRevenueCzk: nullableNumber(
              scenario.annualExportRevenueCzk,
            ),
            annualFixedCostCzk: nullableNumber(scenario.annualFixedCostCzk),
            evaluatedDays:
              typeof object(scenario.assumptions).evaluatedDays === "number"
                ? Number(object(scenario.assumptions).evaluatedDays)
                : null,
            savingsVsSelfUseCzk: nullableNumber(scenario.savingsVsSelfUseCzk),
            savingsVsBaselineCzk: nullableNumber(scenario.savingsVsBaselineCzk),
            savingsProductCzk: nullableNumber(scenario.savingsProductCzk),
            savingsDistributionCzk: nullableNumber(
              scenario.savingsDistributionCzk,
            ),
            savingsControlCzk: nullableNumber(scenario.savingsControlCzk),
            batteryCapacityKwh: scenario.batteryCapacityKwh,
            batteryMaxChargeKw: scenario.batteryMaxChargeKw,
            batteryMaxDischargeKw: scenario.batteryMaxDischargeKw,
            pvCapacityKwp: scenario.pvCapacityKwp,
            mainFuseA: scenario.mainFuseA,
            investmentAssessment: investmentSummary(
              object(scenario.assumptions).investmentAssessment,
            ),
            unservedKwh: number(
              (scenario.result as { unservedKwh?: number } | null)?.unservedKwh,
            ),
            priceLabel: curveLabel(scenario.priceCurve),
            pricingMode:
              scenario.priceCurve.buyProductVersion?.buyMode ??
              (typeof object(scenario.priceCurve.assumptions).pricingMode ===
              "string"
                ? String(
                    object(scenario.priceCurve.assumptions).pricingMode,
                  )
                : "NEUVEDENO"),
            sellPricingMode:
              scenario.priceCurve.sellProductVersion?.sellMode ??
              (typeof object(scenario.priceCurve.assumptions)
                .sellPricingMode === "string"
                ? String(
                    object(scenario.priceCurve.assumptions).sellPricingMode,
                  )
                : "NEUVEDENO"),
            buySupplierName:
              scenario.priceCurve.buyProductVersion?.product.supplier.name ??
              "Modelový ceník",
            sellSupplierName:
              scenario.priceCurve.sellProductVersion?.product.supplier.name ??
              scenario.priceCurve.buyProductVersion?.product.supplier.name ??
              "Modelový ceník",
            productName:
              scenario.priceCurve.buyProductVersion?.product.name ??
              curveLabel(scenario.priceCurve),
            sellProductName:
              scenario.priceCurve.sellProductVersion?.product.name ??
              scenario.priceCurve.buyProductVersion?.product.name ??
              curveLabel(scenario.priceCurve),
            buySourceUrl:
              typeof object(
                scenario.priceCurve.buyProductVersion?.product.metadata ?? {},
              ).sourceUrl === "string"
                ? String(
                    object(
                      scenario.priceCurve.buyProductVersion?.product.metadata ??
                        {},
                    ).sourceUrl,
                  )
                : null,
            sellSourceUrl:
              typeof object(
                scenario.priceCurve.sellProductVersion?.product.metadata ?? {},
              ).sourceUrl === "string"
                ? String(
                    object(
                      scenario.priceCurve.sellProductVersion?.product
                        .metadata ?? {},
                    ).sourceUrl,
                  )
                : null,
            buyAvailabilityNote:
              typeof object(
                scenario.priceCurve.buyProductVersion?.product.metadata ?? {},
              ).availabilityNote === "string"
                ? String(
                    object(
                      scenario.priceCurve.buyProductVersion?.product.metadata ??
                        {},
                    ).availabilityNote,
                  )
                : null,
            sellAvailabilityNote:
              typeof object(
                scenario.priceCurve.sellProductVersion?.product.metadata ?? {},
              ).availabilityNote === "string"
                ? String(
                    object(
                      scenario.priceCurve.sellProductVersion?.product
                        .metadata ?? {},
                    ).availabilityNote,
                  )
                : null,
            fixedBuyVtCzkKwh: nullableNumber(
              scenario.priceCurve.buyProductVersion?.fixedBuyVtCzkKwh,
            ),
            fixedBuyNtCzkKwh: nullableNumber(
              scenario.priceCurve.buyProductVersion?.fixedBuyNtCzkKwh,
            ),
            spotBuyFeeCzkKwh: nullableNumber(
              scenario.priceCurve.buyProductVersion?.spotBuyFeeCzkKwh,
            ),
            fixedSellVtCzkKwh: nullableNumber(
              scenario.priceCurve.sellProductVersion?.fixedSellVtCzkKwh,
            ),
            fixedSellNtCzkKwh: nullableNumber(
              scenario.priceCurve.sellProductVersion?.fixedSellNtCzkKwh,
            ),
            spotSellFeeCzkKwh: nullableNumber(
              scenario.priceCurve.sellProductVersion?.spotSellFeeCzkKwh,
            ),
            distributionCode:
              scenario.priceCurve.distributionVersion?.distributionTariff
                .code ??
              (typeof object(scenario.priceCurve.assumptions)
                .distributionCode === "string"
                ? String(
                    object(scenario.priceCurve.assumptions).distributionCode,
                  )
                : null),
            distributionEligibilityNote:
              scenario.priceCurve.distributionVersion?.distributionTariff
                .eligibilityNote ?? null,
            distributionVtCzkKwh: nullableNumber(
              scenario.priceCurve.distributionVersion?.distributionVtCzkKwh,
            ),
            distributionNtCzkKwh: nullableNumber(
              scenario.priceCurve.distributionVersion?.distributionNtCzkKwh,
            ),
            systemServicesCzkKwh: nullableNumber(
              scenario.priceCurve.distributionVersion?.systemServicesCzkKwh,
            ),
            electricityTaxCzkKwh: nullableNumber(
              scenario.priceCurve.distributionVersion?.electricityTaxCzkKwh,
            ),
            pozeCzkKwh: nullableNumber(
              scenario.priceCurve.distributionVersion?.pozeCzkKwh,
            ),
            monthlyMeterFeeCzk: nullableNumber(
              scenario.priceCurve.distributionVersion?.monthlyMeterFeeCzk,
            ),
            monthlyBreakerFeeCzk:
              scenario.priceCurve.distributionVersion &&
              profile?.phases &&
              scenario.mainFuseA
                ? breakerMonthlyFee(
                    scenario.priceCurve.distributionVersion.breakerFees,
                    profile.phases,
                    scenario.mainFuseA,
                  )
                : null,
            currentDistribution:
              scenario.priceCurve.distributionVersion?.distributionTariff.code.toUpperCase() ===
              profile?.distributionTariffCode?.toUpperCase(),
            currentScenario: scenario.priceCurve.purpose === "CURRENT_BASELINE",
            referenceScenario:
              scenario.priceCurve.purpose ===
              "REFERENCE_BASELINE:CEZ_D01D_NO_COMMITMENT",
            hdoMode:
              object(scenario.priceCurve.assumptions).hdoMode ?? "NEUVEDENO",
          })),
        })),
      };
    }),
  };
}

export async function queueAnalysisPreparation(userId: number, raw: unknown) {
  const request = analysisRequestSchema.parse(raw);
  const owned = await prisma.energySite.findFirst({
    where: { id: request.siteId, userId, inverters: { some: {} } },
    select: { id: true },
  });
  if (!owned) throw new Error("ANALYSIS_SITE_NOT_FOUND");

  const requestFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        userId,
        request,
        engine: ANALYSIS_ENGINE_VERSION,
        methodology: ANALYSIS_METHODOLOGY_VERSION,
      }),
    )
    .digest("hex");
  const idempotencyKey = `energy-analysis-prepare:${requestFingerprint}`;
  const payload = { version: 1 as const, userId, request };

  return prisma.$transaction(async (tx) => {
    const existing = await tx.scheduledJob.findUnique({
      where: { idempotencyKey },
    });
    if (
      existing &&
      (existing.status === JobStatus.PENDING ||
        existing.status === JobStatus.RUNNING)
    )
      return existing;
    const job = await tx.scheduledJob.upsert({
      where: { idempotencyKey },
      update: {
        payload,
        status: JobStatus.PENDING,
        runAt: new Date(),
        attempts: 0,
        lockedAt: null,
        lastError: null,
        completedAt: null,
      },
      create: {
        type: ENERGY_ANALYSIS_PREPARE_JOB,
        idempotencyKey,
        payload,
        runAt: new Date(),
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "ENERGY_ANALYSIS_PREPARATION_QUEUED",
        entityType: "ScheduledJob",
        entityId: job.id,
        metadata: { siteId: request.siteId, kind: request.kind },
      },
    });
    return job;
  });
}

export async function enqueueAnalysis(userId: number, raw: unknown) {
  const input = analysisRequestSchema.parse(raw);
  const owned = await prisma.energySite.findFirst({
    where: { id: input.siteId, userId },
    select: { id: true, inverters: { select: { id: true }, take: 1 } },
  });
  if (!owned?.inverters[0]) throw new Error("ANALYSIS_SITE_NOT_FOUND");
  // Starting an analysis must be safe even when it is invoked directly (for
  // example by an API client or a queued customer action) without first
  // rendering the page that normally fills conservative analysis defaults.
  await prepareAnalysisDefaults(userId, input.siteId, {
    refreshRemote: false,
  });
  const site = await prisma.energySite.findFirst({
    where: { id: input.siteId, userId },
    include: {
      technicalProfile: true,
      inverters: { orderBy: { id: "asc" } },
      fieldEvidence: {
        where: { field: { in: ["mainFuseA", "maxGridInputKw"] } },
        orderBy: { observedAt: "desc" },
      },
    },
  });
  if (!site || !site.inverters[0]) throw new Error("ANALYSIS_SITE_NOT_FOUND");
  const quality = await getEnergyDataQuality(userId, site.id);
  if (!quality.readyForEstimate || !quality.from || !quality.to)
    throw new Error("ANALYSIS_HISTORY_INSUFFICIENT");
  const profile = site.technicalProfile;
  if (
    !profile ||
    profile.pvCapacityKwp == null ||
    profile.batteryCapacityKwh == null
  )
    throw new Error("ANALYSIS_PROFILE_UNCONFIRMED");
  const dataFrom = new Date(quality.from);
  const dataTo = new Date(new Date(quality.to).getTime() + 15 * 60_000);
  await ensureOteMarketCoverage(userId, dataFrom, dataTo);
  await ensurePublishedCatalogCurvesForSite(userId, site.id);
  const allCurves = await prisma.energyPriceCurve.findMany({
    where: {
      energySiteId: site.id,
      status: "READY",
      validFrom: { lte: dataFrom },
      validTo: { gte: dataTo },
      points: { some: {} },
    },
    orderBy: [{ purpose: "asc" }, { createdAt: "desc" }],
    include: {
      buyProductVersion: {
        include: { product: { include: { supplier: true } } },
      },
      sellProductVersion: {
        include: { product: { include: { supplier: true } } },
      },
      distributionVersion: { include: { distributionTariff: true } },
    },
  });
  const activeCurves = allCurves.filter(
    (curve) =>
      (curve.buyProductVersion?.product.active ?? true) &&
      (curve.sellProductVersion?.product.active ?? true) &&
      (curve.distributionVersion?.distributionTariff.active ?? true),
  );
  const candidateCurves = activeCurves.some((curve) =>
    curve.purpose.startsWith("CATALOG"),
  )
    ? activeCurves.filter(
        (curve) => curve.purpose !== "MODELED_STANDARD_CZ_2026",
      )
    : activeCurves;
  const requestedCurveIds = new Set(input.selectedPriceCurveIds);
  const selectedCurveIds = requestedCurveIds.size > 0
    ? requestedCurveIds
    : new Set(selectAnalysisCurveIds(
      candidateCurves.map((curve) => ({
        id: curve.id,
        purpose: curve.purpose,
        buyMode:
          curve.buyProductVersion?.buyMode ??
          (typeof object(curve.assumptions).pricingMode === "string"
            ? String(object(curve.assumptions).pricingMode)
            : null),
        sellMode:
          curve.sellProductVersion?.sellMode ??
          (typeof object(curve.assumptions).sellPricingMode === "string"
            ? String(object(curve.assumptions).sellPricingMode)
            : null),
        distributionCode:
          curve.distributionVersion?.distributionTariff.code ??
          (typeof object(curve.assumptions).distributionCode === "string"
            ? String(object(curve.assumptions).distributionCode)
            : null),
        selectionScore: (() => {
          const buyProduct = curve.buyProductVersion;
          const sellProduct = curve.sellProductVersion;
          if (!buyProduct || !sellProduct)
            return Number.POSITIVE_INFINITY;
          const annualImportKwh = Math.max(
            500,
            quality.annualizedConsumptionKwh * 0.4,
          );
          const annualExportKwh = Math.max(
            500,
            quality.annualizedProductionKwh -
              quality.annualizedConsumptionKwh,
          );
          const buyUnit =
            buyProduct.buyMode === "SPOT"
              ? number(buyProduct.spotBuyFeeCzkKwh)
              : (number(buyProduct.fixedBuyVtCzkKwh) +
                  number(
                    buyProduct.fixedBuyNtCzkKwh,
                    number(buyProduct.fixedBuyVtCzkKwh),
                  )) /
                2;
          const sellUnit =
            sellProduct.sellMode === "SPOT"
              ? -number(sellProduct.spotSellFeeCzkKwh)
              : (number(sellProduct.fixedSellVtCzkKwh) +
                  number(
                    sellProduct.fixedSellNtCzkKwh,
                    number(sellProduct.fixedSellVtCzkKwh),
                  )) /
                2;
          return (
            (number(buyProduct.monthlyFeeCzk) +
              (buyProduct.id === sellProduct.id
                ? 0
                : number(sellProduct.monthlyFeeCzk))) *
              12 +
            buyUnit * annualImportKwh -
            sellUnit * annualExportKwh
          );
        })(),
      })),
      input.kind === "PRO" && input.compareAllTariffs,
    ));
  const curves = candidateCurves.filter((curve) =>
    selectedCurveIds.has(curve.id),
  );
  if (requestedCurveIds.size > 0 && curves.length !== requestedCurveIds.size)
    throw new Error("ANALYSIS_PRICE_CURVES_MISSING");
  if (!curves.length) throw new Error("ANALYSIS_PRICE_CURVES_MISSING");
  if (input.investment) {
    const ids = [
      input.investment.grantVersionId,
      input.investment.loanVersionId,
    ].filter((id): id is number => id != null);
    const versions = await prisma.fundingProgramVersion.findMany({
      where: {
        id: { in: ids },
        status: "PUBLISHED",
        validFrom: { lte: new Date() },
        OR: [{ validTo: null }, { validTo: { gt: new Date() } }],
      },
      include: { fundingProgram: true },
    });
    if (
      versions.length !== ids.length ||
      (input.investment.grantVersionId &&
        versions.find(
          (version) => version.id === input.investment!.grantVersionId,
        )?.fundingProgram.kind !== "GRANT") ||
      (input.investment.loanVersionId &&
        versions.find(
          (version) => version.id === input.investment!.loanVersionId,
        )?.fundingProgram.kind !== "LOAN")
    )
      throw new Error("ANALYSIS_FUNDING_VERSION_INVALID");
    const loan = input.investment.loanVersionId
      ? versions.find(
          (version) => version.id === input.investment!.loanVersionId,
        )
      : null;
    if (loan) {
      const conditions = object(loan.conditions);
      const term = input.investment.termMonths!;
      const amount = input.investment.financedAmountCzk!;
      const minimum = nullableNumber(loan.minimumAmountCzk);
      const maximum = nullableNumber(loan.maximumAmountCzk);
      if (
        typeof conditions.termMonthsMin !== "number" ||
        typeof conditions.termMonthsMax !== "number" ||
        term < conditions.termMonthsMin ||
        term > conditions.termMonthsMax ||
        (minimum != null && amount < minimum) ||
        (maximum != null && amount > maximum) ||
        amount > input.investment.capexCzk
      )
        throw new Error("ANALYSIS_INVESTMENT_INPUT_INVALID");
    }
  }
  const trustedEvidence = (field: "mainFuseA" | "maxGridInputKw") =>
    site.fieldEvidence.find(
      (evidence) =>
        evidence.field === field &&
        (evidence.source !== "MODEL" || evidence.confirmedAt != null),
    );
  const trustedFuseLimit = trustedEvidence("mainFuseA")
    ? fusePowerKw(profile.phases, profile.mainFuseA)
    : null;
  const trustedGridInput = trustedEvidence("maxGridInputKw")
    ? profile.maxGridInputKw
    : null;
  const effectiveCurrentGridInputKw =
    trustedGridInput == null
      ? trustedFuseLimit
      : trustedFuseLimit == null
        ? trustedGridInput
        : Math.min(trustedGridInput, trustedFuseLimit);
  const current = {
    batteryCapacityKwh: profile.batteryCapacityKwh,
    batteryMaxChargeKw:
      profile.batteryMaxChargeKw ?? profile.batteryCapacityKwh * 0.5,
    batteryMaxDischargeKw:
      profile.batteryMaxDischargeKw ?? profile.batteryCapacityKwh * 0.5,
    pvCapacityKwp: profile.pvCapacityKwp,
    maxGridInputKw: effectiveCurrentGridInputKw,
    maxGridOutputKw: profile.maxGridOutputKw,
    mainFuseA: profile.mainFuseA,
  };
  const variants =
    input.kind === "BASE"
      ? [current]
      : [
          current,
          ...input.hardwareVariants.map((variant) => {
            const mainFuseA = variant.mainFuseA ?? profile.mainFuseA;
            const physicalFuseLimit =
              variant.mainFuseA != null || trustedEvidence("mainFuseA")
                ? fusePowerKw(profile.phases, mainFuseA)
                : null;
            const requestedGridLimit =
              variant.maxGridInputKw ??
              physicalFuseLimit ??
              effectiveCurrentGridInputKw;
            return {
              ...variant,
              mainFuseA,
              batteryMaxChargeKw:
                variant.batteryMaxChargeKw ??
                profile.batteryMaxChargeKw ??
                variant.batteryCapacityKwh * 0.5,
              batteryMaxDischargeKw:
                variant.batteryMaxDischargeKw ??
                profile.batteryMaxDischargeKw ??
                variant.batteryCapacityKwh * 0.5,
              maxGridInputKw:
                requestedGridLimit == null || physicalFuseLimit == null
                  ? requestedGridLimit
                  : Math.min(requestedGridLimit, physicalFuseLimit),
              maxGridOutputKw:
                variant.maxGridOutputKw ?? profile.maxGridOutputKw,
            };
          }),
        ];
  const uniqueVariants = [
    ...new Map(
      variants.map((variant) => [
        `${variant.batteryCapacityKwh}:${variant.batteryMaxChargeKw}:${variant.batteryMaxDischargeKw}:${variant.pvCapacityKwp}:${variant.maxGridInputKw ?? "none"}:${variant.maxGridOutputKw ?? "none"}:${variant.mainFuseA ?? "none"}`,
        variant,
      ]),
    ).values(),
  ];
  for (const variant of uniqueVariants) {
    if (
      variant.mainFuseA == null ||
      profile.mainFuseA == null ||
      variant.mainFuseA === profile.mainFuseA
    )
      continue;
    if (
      !profile.phases ||
      curves.some(
        (curve) =>
          !curve.distributionVersion ||
          !availableBreakerAmperes(
            curve.distributionVersion.breakerFees,
            profile.phases,
          ).includes(variant.mainFuseA!),
      )
    )
      throw new Error("ANALYSIS_BREAKER_FEE_MISSING");
  }
  const billablePointCount =
    input.kind === "PRO"
      ? Math.max(0, uniqueVariants.length - 1) +
        input.selectedPriceCurveIds.length
      : 0;
  const proPriceMinor =
    input.kind === "PRO"
      ? calculateProAnalysisPriceMinor({
          billablePointCount,
          compareAllTariffs: input.compareAllTariffs,
        })
      : 0;
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        siteId: site.id,
        kind: input.kind,
        dataFrom: dataFrom.toISOString(),
        dataTo: dataTo.toISOString(),
        profileUpdatedAt: profile.updatedAt.toISOString(),
        curves: curves.map((curve) => curve.fingerprint),
        variants: uniqueVariants,
        compareAllTariffs: input.compareAllTariffs,
        selectedPriceCurveIds: input.selectedPriceCurveIds,
        pricePerExtraPointMinor: PRO_EXTRA_POINT_PRICE_MINOR,
        engine: ANALYSIS_ENGINE_VERSION,
        methodology: ANALYSIS_METHODOLOGY_VERSION,
      }),
    )
    .digest("hex");
  const existing = await prisma.energyAnalysisRun.findUnique({
    where: {
      energySiteId_inputFingerprint: {
        energySiteId: site.id,
        inputFingerprint: fingerprint,
      },
    },
  });
  if (existing) {
    if (
      (existing.status === "SUPERSEDED" &&
        existing.errorCode === "CANCELED_BY_USER") ||
      existing.status === "FAILED"
    ) {
      return prisma.$transaction(async (tx) => {
        const run = await tx.energyAnalysisRun.update({
          where: { id: existing.id },
          data: {
            status: proPriceMinor > 0 ? "DRAFT" : "QUEUED",
            errorCode: null,
            errorMessage: null,
            startedAt: null,
            completedAt: null,
          },
        });
        await tx.energyAnalysisScenario.updateMany({
          where: { analysisRunId: run.id },
          data: {
            status: "QUEUED",
            annualCostCzk: null,
            annualCostLowerCzk: null,
            annualCostUpperCzk: null,
            annualImportCostCzk: null,
            annualExportRevenueCzk: null,
            annualFixedCostCzk: null,
            savingsVsBaselineCzk: null,
            savingsVsSelfUseCzk: null,
            savingsProductCzk: null,
            savingsDistributionCzk: null,
            savingsControlCzk: null,
            result: {},
            assumptions: {},
            completedAt: null,
          },
        });
        if (proPriceMinor === 0)
          await tx.scheduledJob.upsert({
            where: { idempotencyKey: `energy-analysis:${run.id}` },
            update: {
              status: "PENDING",
              runAt: new Date(),
              attempts: 0,
              lockedAt: null,
              lastError: null,
              completedAt: null,
            },
            create: {
              type: ENERGY_ANALYSIS_JOB,
              idempotencyKey: `energy-analysis:${run.id}`,
              payload: { version: 2, analysisRunId: run.id },
              runAt: new Date(),
            },
          });
        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: "ENERGY_ANALYSIS_REQUEUED",
            entityType: "EnergyAnalysisRun",
            entityId: run.id,
          },
        });
        return run;
      });
    }
    return existing;
  }
  const scenarios = uniqueVariants.flatMap((variant, variantIndex) =>
    curves.flatMap((curve) =>
      (["SELF_USE", "SMART"] as const).map((controlMode) => ({
        scenarioKey: `v${variantIndex}:${curve.id}:${controlMode}`,
        label: `${curveLabel(curve)} · ${controlMode === "SELF_USE" ? "self-use" : "chytré řízení"}`,
        controlMode,
        priceCurveId: curve.id,
        batteryCapacityKwh: variant.batteryCapacityKwh,
        batteryMaxChargeKw: variant.batteryMaxChargeKw,
        batteryMaxDischargeKw: variant.batteryMaxDischargeKw,
        pvCapacityKwp: variant.pvCapacityKwp,
        maxGridInputKw: variant.maxGridInputKw,
        maxGridOutputKw: variant.maxGridOutputKw,
        mainFuseA: variant.mainFuseA,
      })),
    ),
  );
  return prisma.$transaction(async (tx) => {
    const run = await tx.energyAnalysisRun.create({
      data: {
        userId,
        energySiteId: site.id,
        status: proPriceMinor > 0 ? "DRAFT" : "QUEUED",
        kind: input.kind,
        engineVersion: ANALYSIS_ENGINE_VERSION,
        methodologyVersion: ANALYSIS_METHODOLOGY_VERSION,
        inputFingerprint: fingerprint,
        dataFrom,
        dataTo,
        confidence: quality.confidence,
        requestedPointCount: uniqueVariants.length,
        includedPointCount: 1,
        billablePointCount,
        pricePerExtraPointMinor: PRO_EXTRA_POINT_PRICE_MINOR,
        catalogComparisonPriceMinor: input.compareAllTariffs
          ? PRO_ALL_TARIFFS_PRICE_MINOR
          : 0,
        proPriceMinor,
        inputs: {
          current,
          variants: uniqueVariants,
          investment: input.investment ?? null,
          compareAllTariffs: input.compareAllTariffs,
          selectedPriceCurveIds: input.selectedPriceCurveIds,
        },
        assumptions: {
          hdoByCurve: curves.map((curve) => ({
            id: curve.id,
            hdoCalendarId: curve.hdoCalendarId,
            curveAssumptions: curve.assumptions,
          })),
          smartEngineProductionReady: ANALYSIS_PRODUCTION_READY,
          smartMethod: ROLLING_MILP_METHOD_VERSION,
          horizonHours: 34,
          maximumSolverCallsPerScenario: ANALYSIS_MAX_SOLVER_CALLS,
          planningResolutionMinutes: 60,
          forecastWarmupDays: ANALYSIS_FORECAST_WARMUP_DAYS,
          batteryCycleCostCzkKwh: DEFAULT_BATTERY_CYCLE_COST_CZK_KWH,
          productionCalibration: {
            actual: "MEASURED_INVERTER_PRODUCTION",
            forecast: "WALK_FORWARD_SELECTED_SEPARATELY",
            hardwareVariant: "MEASURED_BASELINE_SCALED_BY_CONFIRMED_KWP",
          },
        },
        sourceVersions: {
          curves: curves.map((curve) => ({
            id: curve.id,
            fingerprint: curve.fingerprint,
            hdoCalendarId: curve.hdoCalendarId,
          })),
        },
        scenarios: { create: scenarios },
      },
    });
    if (proPriceMinor === 0) {
      await tx.scheduledJob.create({
        data: {
          type: ENERGY_ANALYSIS_JOB,
          idempotencyKey: `energy-analysis:${run.id}`,
          payload: { version: 2, analysisRunId: run.id },
          runAt: new Date(),
        },
      });
    }
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "ENERGY_ANALYSIS_REQUESTED",
        entityType: "EnergyAnalysisRun",
        entityId: run.id,
        metadata: {
          siteId: site.id,
          kind: input.kind,
          billablePointCount,
          compareAllTariffs: input.compareAllTariffs,
          proPriceMinor,
        },
      },
    });
    return run;
  });
}

async function loadDispatchPoints(
  run: {
    dataFrom: Date | null;
    dataTo: Date | null;
    energySite: { timezone: string; inverters: Array<{ id: number }> };
  },
  curveId: string,
) {
  if (!run.dataFrom || !run.dataTo || !run.energySite.inverters.length)
    throw new Error("ANALYSIS_WINDOW_MISSING");
  const [intervals, prices, curve] = await Promise.all([
    prisma.energyInterval.findMany({
      where: {
        inverterId: { in: run.energySite.inverters.map((inverter) => inverter.id) },
        predicted: false,
        kind: {
          in: [
            EnergyIntervalKind.PRODUCTION,
            EnergyIntervalKind.CONSUMPTION,
            EnergyIntervalKind.BATTERY,
            EnergyIntervalKind.GRID_IMPORT,
            EnergyIntervalKind.GRID_EXPORT,
          ],
        },
        startAt: { gte: run.dataFrom, lt: run.dataTo },
      },
      orderBy: [{ startAt: "asc" }, { kind: "asc" }],
    }),
    prisma.energyPriceCurvePoint.findMany({
      where: { curveId, startAt: { gte: run.dataFrom, lt: run.dataTo } },
      orderBy: { startAt: "asc" },
    }),
    prisma.energyPriceCurve.findUnique({
      where: { id: curveId },
      include: {
        buyProductVersion: true,
        sellProductVersion: true,
        distributionVersion: true,
      },
    }),
  ]);
  if (!curve) throw new Error("ANALYSIS_PRICE_CURVE_DEFINITION_MISSING");
  const loadProfile = deriveIndependentLoadProfile(
    aggregateSiteIntervals(intervals),
  );
  const price = new Map(
    prices.map((point) => [point.startAt.getTime(), point]),
  );
  const model = loadProfile.points.flatMap(
    (item): HdoSensitivityPricePoint[] => {
      const pricePoint = price.get(item.startAt.getTime());
      if (!pricePoint) return [];
      return [
        {
          ...item,
          commodityBuyCzkKwh: Number(pricePoint.commodityBuyCzkKwh),
          commoditySellCzkKwh: Number(pricePoint.commoditySellCzkKwh),
          distributionCzkKwh: Number(pricePoint.distributionCzkKwh),
          otherRegulatedCzkKwh: Number(pricePoint.otherRegulatedCzkKwh),
          totalBuyCzkKwh: Number(pricePoint.totalBuyCzkKwh),
          totalSellCzkKwh: Number(pricePoint.totalSellCzkKwh),
        },
      ];
    },
  );
  const forecastSelection = selectForecastPolicy(
    model,
    run.energySite.timezone,
  );
  const curveAssumptions = object(curve.assumptions);
  const hdoMode = String(curveAssumptions.hdoMode ?? "");
  if (!hdoMode.startsWith("MODEL:"))
    return {
      model,
      allVt: null,
      allNt: null,
      loadProfile: loadProfile.provenance,
      forecastSelection,
    };
  const currentPrice = object(
    (curveAssumptions.priceInput ?? {}) as Prisma.JsonValue,
  );
  const optionalNumber = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const buyProduct = curve.buyProductVersion;
  const sellProduct = curve.sellProductVersion;
  const modeledDefinition = modeledHdoDefinition(curveAssumptions.prices);
  const definition = modeledDefinition ?? (curve.distributionVersion ? {
    distributionVtCzkKwh: Number(curve.distributionVersion.distributionVtCzkKwh),
    distributionNtCzkKwh: Number(curve.distributionVersion.distributionNtCzkKwh),
    buy: buyProduct
      ? {
          mode: buyProduct.buyMode,
          vtCzkKwh: nullableNumber(buyProduct.fixedBuyVtCzkKwh),
          ntCzkKwh: nullableNumber(buyProduct.fixedBuyNtCzkKwh),
        }
      : {
          mode: String(currentPrice.buyMode ?? ""),
          vtCzkKwh: optionalNumber(currentPrice.fixedBuyPriceCzkKwh),
          ntCzkKwh: optionalNumber(currentPrice.fixedBuyPriceCzkKwh),
        },
    sell: sellProduct
      ? {
          mode: sellProduct.sellMode,
          vtCzkKwh: nullableNumber(sellProduct.fixedSellVtCzkKwh),
          ntCzkKwh: nullableNumber(sellProduct.fixedSellNtCzkKwh),
        }
      : {
          mode: String(currentPrice.sellMode ?? ""),
          vtCzkKwh: optionalNumber(currentPrice.fixedSellPriceCzkKwh),
          ntCzkKwh: optionalNumber(currentPrice.fixedSellPriceCzkKwh),
        },
  } : null);
  if (!definition) throw new Error("ANALYSIS_PRICE_CURVE_DEFINITION_MISSING");
  return {
    model,
    allVt: applyHdoExtreme(model, definition, false),
    allNt: applyHdoExtreme(model, definition, true),
    loadProfile: loadProfile.provenance,
    forecastSelection,
  };
}

async function executeRun(runId: string, onProgress?: () => Promise<void>) {
  const budgetStartedAt = Date.now();
  const run = await prisma.energyAnalysisRun.findUnique({
    where: { id: runId },
    include: {
      energySite: {
        include: {
          technicalProfile: true,
          inverters: { orderBy: { id: "asc" } },
        },
      },
      scenarios: {
        include: {
          priceCurve: {
            include: {
              distributionVersion: { include: { distributionTariff: true } },
            },
          },
        },
      },
    },
  });
  if (!run || !run.energySite.technicalProfile || !run.dataFrom || !run.dataTo)
    throw new Error("ANALYSIS_RUN_INVALID");
  const profile = run.energySite.technicalProfile;
  const currentPvKwp = profile.pvCapacityKwp;
  if (currentPvKwp == null) throw new Error("ANALYSIS_PROFILE_INCOMPLETE");
  const investmentInput = object(
    object(run.inputs).investment as Prisma.JsonValue,
  );
  const investmentCapexCzk =
    typeof investmentInput.capexCzk === "number"
      ? investmentInput.capexCzk
      : null;
  const grantVersionId =
    typeof investmentInput.grantVersionId === "number"
      ? investmentInput.grantVersionId
      : null;
  const loanVersionId =
    typeof investmentInput.loanVersionId === "number"
      ? investmentInput.loanVersionId
      : null;
  const investmentVersions =
    run.kind === "PRO" && investmentCapexCzk != null
      ? await prisma.fundingProgramVersion.findMany({
          where: {
            id: {
              in: [grantVersionId, loanVersionId].filter(
                (id): id is number => id != null,
              ),
            },
            status: "PUBLISHED",
          },
          include: { fundingProgram: true },
        })
      : [];
  const grantVersion =
    grantVersionId == null
      ? null
      : (investmentVersions.find(
          (version) =>
            version.id === grantVersionId &&
            version.fundingProgram.kind === "GRANT",
        ) ?? null);
  const loanVersion =
    loanVersionId == null
      ? null
      : (investmentVersions.find(
          (version) =>
            version.id === loanVersionId &&
            version.fundingProgram.kind === "LOAN",
        ) ?? null);
  if ((grantVersionId && !grantVersion) || (loanVersionId && !loanVersion))
    throw new Error("ANALYSIS_FUNDING_VERSION_INVALID");
  const pointCache = new Map<
    string,
    Awaited<ReturnType<typeof loadDispatchPoints>>
  >();
  type ResultWithMetadata = AnalysisDispatchResult & {
    solverFallbacks?: number;
    forecastMethod?: string;
    forecastQuality?: ForecastSelection;
  };
  const results = new Map<
    string,
    {
      annualCostCzk: number;
      annualCostLowerCzk: number | null;
      annualCostUpperCzk: number | null;
      variableAnnualCzk: number;
      fixedAnnualCzk: number;
      annualization: number;
      evaluatedDays: number;
      warmupIntervals: number;
      pvScale: number;
      evaluatedConsumptionKwh: number;
      result: ResultWithMetadata;
    }
  >();
  let recordedInputMethod = false;
  const orderedScenarios = [...run.scenarios].sort(
    (left, right) =>
      left.priceCurveId.localeCompare(right.priceCurveId) ||
      (left.controlMode === right.controlMode
        ? 0
        : left.controlMode === "SELF_USE"
          ? -1
          : 1),
  );
  const persistedDispatchResultSchema = z
    .object({
      importKwh: z.number(),
      exportKwh: z.number(),
      chargedKwh: z.number(),
      dischargedKwh: z.number(),
      curtailedKwh: z.number(),
      unservedKwh: z.number(),
      variableCostCzk: z.number(),
      importCostCzk: z.number(),
      exportRevenueCzk: z.number(),
      peakImportKw: z.number(),
      batteryCycles: z.number(),
      endingSocKwh: z.number(),
      strategy: z.enum([
        "SELF_USE",
        "SMART_HEURISTIC",
        "SMART_SELF_USE_FALLBACK",
        "SMART_MILP",
      ]),
      warmupIntervals: z.number().int().nonnegative().optional(),
    })
    .passthrough();
  for (const scenario of orderedScenarios) {
    // A retry must resume the matrix instead of recomputing rows that were
    // already persisted by the progressive first pass. completedAt is also
    // checked because an interrupted retry may have changed a completed row
    // back to RUNNING before the process stopped.
    const persistedResult = persistedDispatchResultSchema.safeParse(
      scenario.result,
    );
    const persistedAssumptions = object(scenario.assumptions);
    const persistedEvaluatedDays =
      typeof persistedAssumptions.evaluatedDays === "number"
        ? persistedAssumptions.evaluatedDays
        : 0;
    if (
      scenario.completedAt &&
      scenario.annualCostCzk != null &&
      scenario.annualFixedCostCzk != null &&
      persistedEvaluatedDays > 0 &&
      persistedResult.success
    ) {
      const persistedForecastWarmup = object(
        persistedAssumptions.forecastWarmup as Prisma.JsonValue,
      );
      const persistedWarmupIntervals =
        persistedResult.data.warmupIntervals ??
        (typeof persistedForecastWarmup.intervals === "number"
          ? persistedForecastWarmup.intervals
          : 0);
      const annualCostCzk = number(scenario.annualCostCzk);
      const fixedAnnualCzk = number(scenario.annualFixedCostCzk);
      results.set(scenario.id, {
        annualCostCzk,
        annualCostLowerCzk: nullableNumber(scenario.annualCostLowerCzk),
        annualCostUpperCzk: nullableNumber(scenario.annualCostUpperCzk),
        variableAnnualCzk: annualCostCzk - fixedAnnualCzk,
        fixedAnnualCzk,
        annualization: 365 / persistedEvaluatedDays,
        evaluatedDays: persistedEvaluatedDays,
        warmupIntervals: persistedWarmupIntervals,
        pvScale:
          currentPvKwp > 0 ? scenario.pvCapacityKwp / currentPvKwp : 1,
        evaluatedConsumptionKwh:
          typeof persistedAssumptions.evaluatedConsumptionKwh === "number"
            ? persistedAssumptions.evaluatedConsumptionKwh
            : Number.POSITIVE_INFINITY,
        result: persistedResult.data as ResultWithMetadata,
      });
      if (scenario.status === "RUNNING") {
        await prisma.energyAnalysisScenario.update({
          where: { id: scenario.id },
          data: { status: "COMPLETED" },
        });
      }
      continue;
    }
    if (Date.now() - budgetStartedAt > ANALYSIS_RUN_BUDGET_MS)
      throw new Error("ANALYSIS_RUN_BUDGET_EXCEEDED");
    await onProgress?.();
    const stillRunning = await prisma.energyAnalysisRun.count({
      where: { id: run.id, status: "RUNNING" },
    });
    if (!stillRunning) throw new Error("ANALYSIS_CANCELED");
    await prisma.energyAnalysisScenario.update({
      where: { id: scenario.id },
      data: { status: "RUNNING" },
    });
    let pointBundle = pointCache.get(scenario.priceCurveId);
    if (!pointBundle) {
      pointBundle = await loadDispatchPoints(run, scenario.priceCurveId);
      pointCache.set(scenario.priceCurveId, pointBundle);
    }
    if (!recordedInputMethod) {
      const currentAssumptions = object(run.assumptions);
      await prisma.energyAnalysisRun.update({
        where: { id: run.id },
        data: {
          assumptions: {
            ...currentAssumptions,
            loadProfile: pointBundle.loadProfile,
            forecastQuality: pointBundle.forecastSelection,
          } as Prisma.InputJsonValue,
        },
      });
      recordedInputMethod = true;
    }
    const points = pointBundle.model;
    if (points.length < 24)
      throw new Error("ANALYSIS_PRICE_OR_ENERGY_COVERAGE_INSUFFICIENT");
    const pvScale =
      currentPvKwp > 0 ? scenario.pvCapacityKwp / currentPvKwp : 1;
    const scenarioPoints =
      pvScale === 1
        ? points
        : points.map((point) => ({
            ...point,
            productionKwh: point.productionKwh * pvScale,
          }));
    const battery = {
      capacityKwh: scenario.batteryCapacityKwh,
      maxChargeKw: scenario.batteryMaxChargeKw,
      maxDischargeKw: scenario.batteryMaxDischargeKw,
      minSocPct: profile.batteryMinSocPct ?? 5,
      maxSocPct: profile.batteryMaxSocPct ?? 95,
      roundtripEfficiencyPct: profile.batteryRoundtripEfficiencyPct ?? 90,
    };
    const grid = {
      maxImportKw: scenario.maxGridInputKw,
      maxExportKw: scenario.maxGridOutputKw,
      exportAllowed:
        profile.exportAllowed ??
        (scenario.maxGridOutputKw != null && scenario.maxGridOutputKw > 0),
    };
    const warmupIntervals =
      scenarioPoints.length >= ANALYSIS_FORECAST_WARMUP_DAYS * 2 * 96
        ? ANALYSIS_FORECAST_WARMUP_DAYS * 96
        : 0;
    const evaluatedIntervals = scenarioPoints.length - warmupIntervals;
    if (evaluatedIntervals < 24)
      throw new Error("ANALYSIS_EVALUATION_COVERAGE_INSUFFICIENT");
    const evaluationAnnualization = 365 / (evaluatedIntervals / 96);
    const evaluatedConsumptionKwh = scenarioPoints
      .slice(warmupIntervals)
      .reduce((total, point) => total + point.consumptionKwh, 0);
    const dispatch = async (dispatchPoints: AnalysisDispatchPoint[]) => {
      if (scenario.controlMode === "SELF_USE")
        return simulateSelfUse(
          dispatchPoints.slice(warmupIntervals),
          battery,
          grid,
          run.energySite.timezone,
        );
      const evaluatedDispatchPoints = dispatchPoints.slice(warmupIntervals);
      const firstPrice = evaluatedDispatchPoints[0];
      const flatPrices =
        firstPrice != null &&
        evaluatedDispatchPoints.every(
          (point) =>
            Math.abs(point.totalBuyCzkKwh - firstPrice.totalBuyCzkKwh) <
              0.000001 &&
            Math.abs(point.totalSellCzkKwh - firstPrice.totalSellCzkKwh) <
              0.000001,
        );
      // With constant prices and a purchase price not lower than the export
      // price, self-consumption is already the economic optimum. Running tens
      // of thousands of equivalent MILP windows would only add latency.
      if (
        flatPrices &&
        firstPrice.totalBuyCzkKwh >= firstPrice.totalSellCzkKwh
      )
        return simulateSelfUse(
          evaluatedDispatchPoints,
          battery,
          grid,
          run.energySite.timezone,
        );
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), ANALYSIS_SCENARIO_TIMEOUT_MS);
      try {
        return await simulateRollingMilp({
          points: dispatchPoints,
          battery,
          grid,
          timezone: run.energySite.timezone,
          horizonHours: 34,
          planningResolutionMinutes: 60,
          maxSolverCalls: ANALYSIS_MAX_SOLVER_CALLS,
          warmupIntervals,
          forecastSelection: pointBundle.forecastSelection,
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          const fallback = simulateSelfUse(
            evaluatedDispatchPoints,
            battery,
            grid,
            run.energySite.timezone,
          );
          return {
            ...fallback,
            strategy: "SMART_SELF_USE_FALLBACK" as const,
            solverCalls: ANALYSIS_MAX_SOLVER_CALLS,
            solverFallbacks: 1,
            forecastMethod: `${ROLLING_MILP_METHOD_VERSION}:TIMEOUT_FALLBACK`,
            forecastQuality: pointBundle.forecastSelection,
            warmupIntervals,
            planningResolutionMinutes: 60,
            replanHours: null,
          };
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    };
    const result = await dispatch(scenarioPoints);
    const variableAnnualCzk = result.variableCostCzk * evaluationAnnualization;
    let breakerMonthlyDelta = 0;
    if (
      scenario.mainFuseA != null &&
      profile.mainFuseA != null &&
      scenario.mainFuseA !== profile.mainFuseA
    ) {
      if (!profile.phases || !scenario.priceCurve.distributionVersion)
        throw new Error("ANALYSIS_BREAKER_FEE_MISSING");
      breakerMonthlyDelta =
        breakerMonthlyFee(
          scenario.priceCurve.distributionVersion.breakerFees,
          profile.phases,
          scenario.mainFuseA,
        ) -
        breakerMonthlyFee(
          scenario.priceCurve.distributionVersion.breakerFees,
          profile.phases,
          profile.mainFuseA,
        );
    }
    const fixedAnnualCzk =
      (Number(scenario.priceCurve.monthlyFixedCzk) + breakerMonthlyDelta) * 12;
    const annualCostCzk = variableAnnualCzk + fixedAnnualCzk;
    let annualCostLowerCzk: number | null = null;
    let annualCostUpperCzk: number | null = null;
    if (run.kind === "PRO" && pointBundle.allVt && pointBundle.allNt) {
      const scale = (candidate: AnalysisDispatchPoint[]) =>
        pvScale === 1
          ? candidate
          : candidate.map((point) => ({
              ...point,
              productionKwh: point.productionKwh * pvScale,
            }));
      const allVtResult = await dispatch(scale(pointBundle.allVt));
      await onProgress?.();
      const allNtResult = await dispatch(scale(pointBundle.allNt));
      const boundResults = [allVtResult, allNtResult];
      const sensitivityEligible = !boundResults.some(
          (bound) =>
            hasMaterialUnservedEnergy(
              bound.unservedKwh,
              evaluatedConsumptionKwh,
            ) ||
            ((bound as AnalysisDispatchResult & { solverFallbacks?: number })
              .solverFallbacks ?? 0) > 0,
        );
      // Sensitivity bounds are optional context. A physically ineligible
      // all-VT/all-NT extreme must not discard an otherwise valid main result.
      if (sensitivityEligible) {
        const candidates = [
          annualCostCzk,
          ...boundResults.map(
            (bound) => bound.variableCostCzk * evaluationAnnualization + fixedAnnualCzk,
          ),
        ];
        annualCostLowerCzk = Math.min(...candidates);
        annualCostUpperCzk = Math.max(...candidates);
      }
    }
    results.set(scenario.id, {
      annualCostCzk,
      annualCostLowerCzk,
      annualCostUpperCzk,
      variableAnnualCzk,
      fixedAnnualCzk,
      annualization: evaluationAnnualization,
      evaluatedDays: evaluatedIntervals / 96,
      warmupIntervals,
      pvScale,
      evaluatedConsumptionKwh,
      result,
    });
    const provisionalEligible =
      !hasMaterialUnservedEnergy(result.unservedKwh, evaluatedConsumptionKwh) &&
      ((result as ResultWithMetadata).solverFallbacks ?? 0) === 0;
    // Persist the independently useful result immediately. The second pass
    // below enriches it with cross-scenario savings once the whole matrix is
    // available, while the UI can already fill this row during a long run.
    await prisma.energyAnalysisScenario.update({
      where: { id: scenario.id },
      data: {
        status: provisionalEligible ? "COMPLETED" : "INELIGIBLE",
        annualCostCzk,
        annualCostLowerCzk,
        annualCostUpperCzk,
        annualImportCostCzk: result.importCostCzk * evaluationAnnualization,
        annualExportRevenueCzk:
          result.exportRevenueCzk * evaluationAnnualization,
        annualFixedCostCzk: fixedAnnualCzk,
        importedKwh: result.importKwh,
        exportedKwh: result.exportKwh,
        chargedKwh: result.chargedKwh,
        dischargedKwh: result.dischargedKwh,
        batteryCycles: result.batteryCycles,
        peakImportKw: result.peakImportKw,
        result,
        assumptions: {
          annualizedFromMeasuredIntervals: true,
          evaluatedDays: evaluatedIntervals / 96,
          annualization: evaluationAnnualization,
          warmupIntervals,
          pvScale,
          evaluatedConsumptionKwh,
          unservedEnergyToleranceKwh: unservedEnergyToleranceKwh(
            evaluatedConsumptionKwh,
          ),
          strategy: result.strategy,
          provisional: true,
        },
        completedAt: new Date(),
      },
    });
    await onProgress?.();
  }
  for (const scenario of run.scenarios) {
    const computed = results.get(scenario.id)!;
    const sameHardware = (candidate: typeof scenario) =>
      candidate.batteryCapacityKwh === scenario.batteryCapacityKwh &&
      candidate.batteryMaxChargeKw === scenario.batteryMaxChargeKw &&
      candidate.batteryMaxDischargeKw === scenario.batteryMaxDischargeKw &&
      candidate.pvCapacityKwp === scenario.pvCapacityKwp &&
      candidate.maxGridInputKw === scenario.maxGridInputKw &&
      candidate.maxGridOutputKw === scenario.maxGridOutputKw &&
      candidate.mainFuseA === scenario.mainFuseA;
    const selfUse = run.scenarios.find(
      (candidate) =>
        candidate.priceCurveId === scenario.priceCurveId &&
        sameHardware(candidate) &&
        candidate.controlMode === "SELF_USE",
    );
    const selfUseComputed = selfUse ? results.get(selfUse.id) : null;
    const selfUseCost =
      selfUseComputed?.annualCostCzk ?? computed.annualCostCzk;
    const currentBaseline = run.scenarios.find(
      (candidate) =>
        candidate.priceCurve.purpose === "CURRENT_BASELINE" &&
        sameHardware(candidate) &&
        candidate.controlMode === "SELF_USE",
    );
    const currentBaselineComputed = currentBaseline
      ? results.get(currentBaseline.id)
      : null;
    const currentDistributionCode =
      profile.distributionTariffCode?.toUpperCase();
    const productOnCurrentDistribution =
      scenario.priceCurve.purpose === "CURRENT_BASELINE"
        ? currentBaseline
        : run.scenarios.find(
            (candidate) =>
              candidate.controlMode === "SELF_USE" &&
              sameHardware(candidate) &&
              candidate.priceCurve.buyProductVersionId ===
                scenario.priceCurve.buyProductVersionId &&
              candidate.priceCurve.distributionVersion?.distributionTariff.code.toUpperCase() ===
                currentDistributionCode,
          );
    const productOnCurrentDistributionComputed = productOnCurrentDistribution
      ? results.get(productOnCurrentDistribution.id)
      : null;
    const rollingMetadata = computed.result;
    const solverFallbacks = rollingMetadata.solverFallbacks ?? 0;
    const eligible =
      !hasMaterialUnservedEnergy(
        computed.result.unservedKwh,
        computed.evaluatedConsumptionKwh,
      ) &&
      !hasMaterialUnservedEnergy(
        selfUseComputed?.result.unservedKwh ?? 0,
        selfUseComputed?.evaluatedConsumptionKwh ??
          computed.evaluatedConsumptionKwh,
      ) &&
      solverFallbacks === 0;
    const investmentAssessment =
      investmentCapexCzk == null
        ? null
        : calculateInvestmentAssessment({
            capexCzk: investmentCapexCzk,
            annualSavingsCzk: currentBaselineComputed
              ? currentBaselineComputed.annualCostCzk - computed.annualCostCzk
              : 0,
            grant: grantVersion
              ? {
                  subsidyRatePct: nullableNumber(grantVersion.subsidyRatePct),
                  maximumAmountCzk: nullableNumber(
                    grantVersion.maximumAmountCzk,
                  ),
                  calculationFormula: grantVersion.calculationFormula,
                }
              : null,
            loan: loanVersion
              ? {
                  principalCzk:
                    typeof investmentInput.financedAmountCzk === "number"
                      ? investmentInput.financedAmountCzk
                      : 0,
                  termMonths:
                    typeof investmentInput.termMonths === "number"
                      ? investmentInput.termMonths
                      : 0,
                  aprPct: number(loanVersion.aprPct),
                  feesCzk: number(loanVersion.feesCzk),
                  minimumAmountCzk: nullableNumber(
                    loanVersion.minimumAmountCzk,
                  ),
                  maximumAmountCzk: nullableNumber(
                    loanVersion.maximumAmountCzk,
                  ),
                  termMonthsMin: Number(
                    object(loanVersion.conditions).termMonthsMin,
                  ),
                  termMonthsMax: Number(
                    object(loanVersion.conditions).termMonthsMax,
                  ),
                }
              : null,
          });
    await prisma.energyAnalysisScenario.update({
      where: { id: scenario.id },
      data: {
        status: eligible ? "COMPLETED" : "INELIGIBLE",
        annualCostCzk: computed.annualCostCzk,
        annualCostLowerCzk: computed.annualCostLowerCzk,
        annualCostUpperCzk: computed.annualCostUpperCzk,
        annualImportCostCzk:
          computed.result.importCostCzk * computed.annualization,
        annualExportRevenueCzk:
          computed.result.exportRevenueCzk * computed.annualization,
        annualFixedCostCzk: computed.fixedAnnualCzk,
        savingsVsSelfUseCzk: eligible
          ? selfUseCost - computed.annualCostCzk
          : null,
        savingsVsBaselineCzk:
          eligible && currentBaselineComputed
            ? currentBaselineComputed.annualCostCzk - computed.annualCostCzk
            : null,
        savingsProductCzk:
          eligible &&
          currentBaselineComputed &&
          productOnCurrentDistributionComputed
            ? currentBaselineComputed.annualCostCzk -
              productOnCurrentDistributionComputed.annualCostCzk
            : null,
        savingsDistributionCzk:
          eligible && productOnCurrentDistributionComputed && selfUseComputed
            ? productOnCurrentDistributionComputed.annualCostCzk -
              selfUseComputed.annualCostCzk
            : null,
        savingsControlCzk:
          eligible && selfUseComputed
            ? selfUseComputed.annualCostCzk - computed.annualCostCzk
            : null,
        importedKwh: computed.result.importKwh,
        exportedKwh: computed.result.exportKwh,
        chargedKwh: computed.result.chargedKwh,
        dischargedKwh: computed.result.dischargedKwh,
        batteryCycles: computed.result.batteryCycles,
        peakImportKw: computed.result.peakImportKw,
        result: computed.result,
        assumptions: {
          annualizedFromMeasuredIntervals: true,
          evaluatedDays: computed.evaluatedDays,
          strategy: computed.result.strategy,
          loadProfile:
            pointCache.get(scenario.priceCurveId)?.loadProfile ?? null,
          productionCalibration: {
            actual: "MEASURED_INVERTER_PRODUCTION",
            forecast:
              scenario.controlMode === "SMART"
                ? "WALK_FORWARD_SELECTED_SEPARATELY"
                : "NOT_USED_BY_SELF_USE",
            capacityScale: computed.pvScale,
          },
          breaker: {
            phases: profile.phases,
            amperes: scenario.mainFuseA,
            physicalLimitKw: scenario.maxGridInputKw,
            fixedAnnualCzk: computed.fixedAnnualCzk,
          },
          investmentAssessment: investmentAssessment
            ? {
                ...investmentAssessment,
                eligibilityConfirmed: true,
                grantVersionId,
                loanVersionId,
              }
            : null,
          forecastMethod: rollingMetadata.forecastMethod ?? null,
          forecastQuality: rollingMetadata.forecastQuality ?? null,
          forecastWarmup: {
            intervals: computed.warmupIntervals,
            days: computed.warmupIntervals / 96,
            excludedFromSavings: true,
          },
          batteryCycleCostCzkKwh: DEFAULT_BATTERY_CYCLE_COST_CZK_KWH,
          solverFallbacks,
          hdoSensitivity:
            computed.annualCostLowerCzk == null
              ? null
              : {
                  method: "REOPTIMIZED_ALL_VT_VS_ALL_NT",
                  lowerCzk: computed.annualCostLowerCzk,
                  upperCzk: computed.annualCostUpperCzk,
                },
        },
        completedAt: new Date(),
      },
    });
  }
  const completedAt = new Date();
  const completion = await prisma.energyAnalysisRun.updateMany({
    where: { id: run.id, status: "RUNNING" },
    data: { status: "COMPLETED", completedAt },
  });
  if (!completion.count) return false;
  if (ANALYSIS_PRODUCTION_READY && run.kind === "BASE") {
    const currentSmart = run.scenarios.filter(
      (scenario) =>
        scenario.controlMode === "SMART" &&
        scenario.priceCurve.purpose === "CURRENT_BASELINE" &&
        scenario.batteryCapacityKwh === profile.batteryCapacityKwh &&
        scenario.batteryMaxChargeKw ===
          (profile.batteryMaxChargeKw ?? profile.batteryCapacityKwh * 0.5) &&
        scenario.batteryMaxDischargeKw ===
          (profile.batteryMaxDischargeKw ?? profile.batteryCapacityKwh * 0.5) &&
        scenario.pvCapacityKwp === profile.pvCapacityKwp &&
        scenario.mainFuseA === profile.mainFuseA,
    );
    if (currentSmart.length === 1) {
      const smart = currentSmart[0];
      const selfUse = run.scenarios.find(
        (scenario) =>
          scenario.controlMode === "SELF_USE" &&
          scenario.priceCurveId === smart.priceCurveId &&
          scenario.batteryCapacityKwh === smart.batteryCapacityKwh &&
          scenario.batteryMaxChargeKw === smart.batteryMaxChargeKw &&
          scenario.batteryMaxDischargeKw === smart.batteryMaxDischargeKw &&
          scenario.pvCapacityKwp === smart.pvCapacityKwp &&
          scenario.mainFuseA === smart.mainFuseA,
      );
      const smartResult = results.get(smart.id);
      const selfUseResult = selfUse ? results.get(selfUse.id) : null;
      if (
        smartResult &&
        selfUseResult &&
        !hasMaterialUnservedEnergy(
          smartResult.result.unservedKwh,
          smartResult.evaluatedConsumptionKwh,
        ) &&
        !hasMaterialUnservedEnergy(
          selfUseResult.result.unservedKwh,
          selfUseResult.evaluatedConsumptionKwh,
        )
      ) {
        const offer = calculateAnnualControlOffer(
          Math.round(
            Math.max(
              0,
              selfUseResult.annualCostCzk - smartResult.annualCostCzk,
            ) * 100,
          ),
        );
        if (offer.finalPriceMinor > 0)
          await prisma.serviceOffer.create({
            data: {
              userId: run.userId,
              energySiteId: run.energySiteId,
              analysisRunId: run.id,
              status: "OFFERED",
              currency: "CZK",
              expectedControlSavingsMinor: offer.expectedControlSavingsMinor,
              listPriceMinor: offer.listPriceMinor,
              savingsShareBps: offer.savingsShareBps,
              discountMinor: offer.discountMinor,
              finalPriceMinor: offer.finalPriceMinor,
              methodologyVersion: run.methodologyVersion,
              inputFingerprint: run.inputFingerprint,
              assumptions: {
                baseline: "SELF_USE",
                sameTariffAndDistribution: true,
                priceCurveId: smart.priceCurveId,
                confidence: run.confidence,
                dataFrom: run.dataFrom?.toISOString() ?? null,
                dataTo: run.dataTo?.toISOString() ?? null,
                estimateNotGuarantee: true,
              },
              validUntil: new Date(completedAt.getTime() + 30 * 86_400_000),
            },
          });
      }
    }
  }
  const user = await prisma.user.findUnique({
    where: { id: run.userId },
    select: { email: true, name: true },
  });
  if (user)
    await queueEmail({
      idempotencyKey: `energy-analysis-v2:${run.id}:completed`,
      to: user.email,
      subject: "Nová analýza Spottex je hotová",
      text: `Dobrý den${user.name ? ` ${user.name}` : ""},\n\nnová verzovaná analýza je hotová. Smart scénář používá produkčně ověřený rolling MILP; zobrazená úspora je modelovaný odhad podle potvrzených vstupů, naměřené historie a verzovaných cen, nikoli záruka budoucího výsledku.\n\n${process.env.APP_URL || "http://localhost:3004"}/app/analyza`,
    });
  return true;
}

export async function recoverStaleAnalysisJobs(
  now = new Date(),
  jobIds?: string[],
) {
  const staleBefore = new Date(now.getTime() - ANALYSIS_STALE_LOCK_MS);
  const jobs = await prisma.scheduledJob.findMany({
    where: {
      type: { in: [ENERGY_ANALYSIS_JOB, ENERGY_ANALYSIS_PREPARE_JOB] },
      status: JobStatus.RUNNING,
      lockedAt: { lt: staleBefore },
      ...(jobIds ? { id: { in: jobIds } } : {}),
    },
    take: 100,
  });
  let recovered = 0;
  let failed = 0;
  for (const job of jobs) {
    if (job.type === ENERGY_ANALYSIS_PREPARE_JOB) {
      const retry = job.attempts < ANALYSIS_MAX_ATTEMPTS;
      await prisma.scheduledJob.update({
        where: { id: job.id },
        data: retry
          ? {
              status: JobStatus.PENDING,
              runAt: now,
              lockedAt: null,
              lastError: "Recovered interrupted analysis preparation",
              completedAt: null,
            }
          : {
              status: JobStatus.FAILED,
              lockedAt: null,
              completedAt: now,
              lastError: "Analysis preparation repeatedly interrupted",
            },
      });
      if (retry) recovered += 1;
      else failed += 1;
      continue;
    }
    const payload = payloadSchema.safeParse(job.payload);
    if (!payload.success) {
      await prisma.scheduledJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.FAILED,
          lockedAt: null,
          completedAt: now,
          lastError: "ANALYSIS_JOB_PAYLOAD_INVALID_AFTER_RECOVERY",
        },
      });
      failed += 1;
      continue;
    }
    const retry = job.attempts < ANALYSIS_MAX_ATTEMPTS;
    await prisma.$transaction([
      prisma.energyAnalysisRun.updateMany({
        where: { id: payload.data.analysisRunId, status: "RUNNING" },
        data: retry
          ? {
              status: "QUEUED",
              startedAt: null,
              errorCode: "ANALYSIS_WORKER_INTERRUPTED",
              errorMessage: "Přerušený výpočet byl bezpečně vrácen do fronty.",
            }
          : {
              status: "FAILED",
              completedAt: now,
              errorCode: "ANALYSIS_WORKER_INTERRUPTED",
              errorMessage: "Výpočet byl opakovaně přerušen.",
            },
      }),
      prisma.energyAnalysisScenario.updateMany({
        where: { analysisRunId: payload.data.analysisRunId, status: "RUNNING" },
        data: { status: retry ? "QUEUED" : "FAILED" },
      }),
      prisma.scheduledJob.update({
        where: { id: job.id },
        data: retry
          ? {
              status: JobStatus.PENDING,
              runAt: now,
              lockedAt: null,
              lastError: "Recovered interrupted analysis",
              completedAt: null,
            }
          : {
              status: JobStatus.FAILED,
              lockedAt: null,
              completedAt: now,
              lastError: "Analysis repeatedly interrupted",
            },
      }),
    ]);
    if (retry) recovered += 1;
    else failed += 1;
  }
  return { scanned: jobs.length, recovered, failed };
}

async function claimAnalysisJob(jobId: string, owner: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ locked: string }>>`
      SELECT pg_advisory_xact_lock(812733, 1)::text AS locked
    `;
    const running = await tx.scheduledJob.count({
      where: {
        type: { in: [ENERGY_ANALYSIS_JOB, ENERGY_ANALYSIS_PREPARE_JOB] },
        status: JobStatus.RUNNING,
      },
    });
    if (running >= ANALYSIS_MAX_CONCURRENT_JOBS) return false;
    const claimed = await tx.scheduledJob.updateMany({
      where: { id: jobId, status: JobStatus.PENDING },
      data: {
        status: JobStatus.RUNNING,
        attempts: { increment: 1 },
        lockedAt: new Date(),
        lastError: owner,
      },
    });
    return claimed.count === 1;
  });
}

export async function processAnalysisJobs(
  options: { limit?: number; onHeartbeat?: () => Promise<void> } = {},
) {
  const recovery = await recoverStaleAnalysisJobs();
  const jobs = await prisma.scheduledJob.findMany({
    where: {
      type: { in: [ENERGY_ANALYSIS_JOB, ENERGY_ANALYSIS_PREPARE_JOB] },
      status: JobStatus.PENDING,
      runAt: { lte: new Date() },
    },
    orderBy: { runAt: "asc" },
    take: Math.min(
      ANALYSIS_JOB_BATCH_LIMIT,
      Math.max(1, options.limit ?? ANALYSIS_JOB_BATCH_LIMIT),
    ),
  });
  let succeeded = 0;
  let failed = 0;
  for (const job of jobs) {
    await options.onHeartbeat?.();
    if (job.type === ENERGY_ANALYSIS_PREPARE_JOB) {
      const preparation = analysisPreparationPayloadSchema.safeParse(job.payload);
      if (!preparation.success) {
        await prisma.scheduledJob.update({
          where: { id: job.id },
          data: {
            status: JobStatus.FAILED,
            lastError: "Neplatná úloha přípravy analýzy.",
            completedAt: new Date(),
          },
        });
        failed += 1;
        continue;
      }
      const owner = `analysis-prepare:${randomUUID()}`;
      if (!(await claimAnalysisJob(job.id, owner))) continue;
      try {
        await enqueueAnalysis(
          preparation.data.userId,
          preparation.data.request,
        );
        await prisma.scheduledJob.updateMany({
          where: { id: job.id, status: JobStatus.RUNNING, lastError: owner },
          data: {
            status: JobStatus.SUCCEEDED,
            lockedAt: null,
            lastError: null,
            completedAt: new Date(),
          },
        });
        succeeded += 1;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message.slice(0, 500)
            : "ANALYSIS_PREPARATION_FAILED";
        const retry =
          job.attempts + 1 < ANALYSIS_MAX_ATTEMPTS &&
          !NON_RETRYABLE_ANALYSIS_ERRORS.has(message);
        await prisma.scheduledJob.updateMany({
          where: { id: job.id, status: JobStatus.RUNNING, lastError: owner },
          data: retry
            ? {
                status: JobStatus.PENDING,
                runAt: new Date(Date.now() + 2 ** job.attempts * 60_000),
                lockedAt: null,
                lastError: message,
                completedAt: null,
              }
            : {
                status: JobStatus.FAILED,
                lockedAt: null,
                lastError: message,
                completedAt: new Date(),
              },
        });
        failed += 1;
      }
      continue;
    }
    const payload = payloadSchema.safeParse(job.payload);
    if (!payload.success) {
      await prisma.scheduledJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          lastError: "Neplatná úloha analýzy.",
          completedAt: new Date(),
        },
      });
      failed += 1;
      continue;
    }
    const owner = `analysis:${randomUUID()}`;
    if (!(await claimAnalysisJob(job.id, owner))) continue;
    const started = await prisma.energyAnalysisRun.updateMany({
      where: { id: payload.data.analysisRunId, status: "QUEUED" },
      data: { status: "RUNNING", startedAt: new Date() },
    });
    if (!started.count) {
      await prisma.scheduledJob.updateMany({
        where: { id: job.id, status: "RUNNING", lastError: owner },
        data: {
          status: "CANCELED",
          lockedAt: null,
          lastError: "ANALYSIS_NOT_QUEUED",
          completedAt: new Date(),
        },
      });
      continue;
    }
    try {
      const completed = await executeRun(
        payload.data.analysisRunId,
        async () => {
          const heartbeat = await prisma.scheduledJob.updateMany({
            where: { id: job.id, status: JobStatus.RUNNING, lastError: owner },
            data: { lockedAt: new Date() },
          });
          if (!heartbeat.count) throw new Error("ANALYSIS_JOB_LEASE_LOST");
          await options.onHeartbeat?.();
        },
      );
      if (!completed) {
        await prisma.scheduledJob.updateMany({
          where: { id: job.id, status: "RUNNING", lastError: owner },
          data: {
            status: "CANCELED",
            lockedAt: null,
            lastError: "INPUTS_CHANGED",
            completedAt: new Date(),
          },
        });
        continue;
      }
      await prisma.scheduledJob.updateMany({
        where: { id: job.id, status: "RUNNING", lastError: owner },
        data: {
          status: "SUCCEEDED",
          lockedAt: null,
          lastError: null,
          completedAt: new Date(),
        },
      });
      succeeded += 1;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message.slice(0, 500)
          : "ANALYSIS_FAILED";
      const retry =
        job.attempts + 1 < ANALYSIS_MAX_ATTEMPTS &&
        !NON_RETRYABLE_ANALYSIS_ERRORS.has(message);
      await prisma.$transaction([
        prisma.energyAnalysisRun.updateMany({
          where: { id: payload.data.analysisRunId, status: "RUNNING" },
          data: retry
            ? {
                status: "QUEUED",
                errorCode: message,
                errorMessage: `Výpočet se nepodařil, automaticky ho opakujeme (pokus ${job.attempts + 1}/${ANALYSIS_MAX_ATTEMPTS}).`,
                startedAt: null,
              }
            : {
              status: "FAILED",
              errorCode: message,
              errorMessage: terminalAnalysisMessage(message),
              completedAt: new Date(),
            },
        }),
        prisma.energyAnalysisScenario.updateMany({
          where: {
            analysisRunId: payload.data.analysisRunId,
            status: "RUNNING",
          },
          data: { status: retry ? "QUEUED" : "FAILED" },
        }),
        prisma.scheduledJob.updateMany({
          where: { id: job.id, status: "RUNNING", lastError: owner },
          data: retry
            ? {
                status: "PENDING",
                runAt: new Date(Date.now() + 2 ** job.attempts * 60_000),
                lockedAt: null,
                lastError: message,
                completedAt: null,
              }
            : {
                status: "FAILED",
                lockedAt: null,
                lastError: message,
                completedAt: new Date(),
              },
        }),
      ]);
      failed += 1;
    }
  }
  return { processed: succeeded + failed, succeeded, failed, recovery };
}

export async function cancelQueuedAnalysis(userId: number, runId: string) {
  const run = await prisma.energyAnalysisRun.findFirst({
    where: { id: runId, userId },
    select: { id: true, status: true },
  });
  if (!run) throw new Error("ANALYSIS_NOT_FOUND");
  if (!["DRAFT", "QUEUED"].includes(run.status))
    throw new Error("ANALYSIS_CANNOT_CANCEL");
  return prisma.$transaction(async (tx) => {
    const canceled = await tx.energyAnalysisRun.updateMany({
      where: { id: run.id, status: { in: ["DRAFT", "QUEUED"] } },
      data: {
        status: "SUPERSEDED",
        errorCode: "CANCELED_BY_USER",
        errorMessage: "Výpočet jste zrušili před spuštěním.",
        completedAt: new Date(),
      },
    });
    if (!canceled.count) throw new Error("ANALYSIS_CANNOT_CANCEL");
    await tx.scheduledJob.updateMany({
      where: { idempotencyKey: `energy-analysis:${run.id}`, status: "PENDING" },
      data: {
        status: "CANCELED",
        completedAt: new Date(),
        lastError: "CANCELED_BY_USER",
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "ENERGY_ANALYSIS_CANCELED",
        entityType: "EnergyAnalysisRun",
        entityId: run.id,
      },
    });
    return { id: run.id, status: "SUPERSEDED" as const };
  });
}
