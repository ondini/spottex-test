import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function main() {
  const [productVersions, distributionVersions, completedRuns, marketSeries] =
    await Promise.all([
      prisma.energyProductVersion.findMany({
        where: { status: "PUBLISHED", product: { active: true } },
        select: { id: true, sourceDocumentId: true },
      }),
      prisma.distributionTariffVersion.findMany({
        where: {
          status: "PUBLISHED",
          distributionTariff: { active: true },
        },
        select: { id: true, sourceDocumentId: true },
      }),
      prisma.energyAnalysisRun.findMany({
        where: { status: "COMPLETED" },
        orderBy: { createdAt: "desc" },
        include: {
          energySite: { select: { id: true, name: true } },
          scenarios: {
            select: {
              priceCurveId: true,
              controlMode: true,
              annualCostCzk: true,
              annualImportCostCzk: true,
              annualExportRevenueCzk: true,
              annualFixedCostCzk: true,
              result: true,
            },
          },
        },
      }),
      prisma.marketPriceSeries.findFirst({
        where: { status: "PUBLISHED" },
        orderBy: { validTo: "desc" },
        select: {
          id: true,
          code: true,
          sourceUrl: true,
          validFrom: true,
          validTo: true,
          _count: { select: { points: true } },
        },
      }),
    ]);
  const [confirmedMarket, predictedMarket] = marketSeries
    ? await Promise.all([
        prisma.marketPricePoint.aggregate({
          where: { seriesId: marketSeries.id, predicted: false },
          _count: true,
          _max: { endAt: true },
        }),
        prisma.marketPricePoint.aggregate({
          where: { seriesId: marketSeries.id, predicted: true },
          _count: true,
          _max: { endAt: true },
        }),
      ])
    : [null, null];

  const latestBySite = new Map<number, (typeof completedRuns)[number]>();
  for (const run of completedRuns) {
    if (!latestBySite.has(run.energySiteId)) latestBySite.set(run.energySiteId, run);
  }
  const latestRuns = [...latestBySite.values()];
  const runReports = latestRuns.map((run) => {
    let maxCostDifferenceCzk = 0;
    let solverFallbackScenarios = 0;
    let intervalTraceScenarios = 0;
    const pairs = new Map<
      string,
      Partial<Record<"SELF_USE" | "SMART", number>>
    >();
    for (const scenario of run.scenarios) {
      const annualCost = Number(scenario.annualCostCzk);
      const identity =
        Number(scenario.annualImportCostCzk) -
        Number(scenario.annualExportRevenueCzk) +
        Number(scenario.annualFixedCostCzk);
      maxCostDifferenceCzk = Math.max(
        maxCostDifferenceCzk,
        Math.abs(annualCost - identity),
      );
      const pair = pairs.get(scenario.priceCurveId) ?? {};
      pair[scenario.controlMode] = annualCost;
      pairs.set(scenario.priceCurveId, pair);
      const result = object(scenario.result);
      if (Number(result.solverFallbacks ?? 0) > 0) solverFallbackScenarios += 1;
      if (Array.isArray(result.trace) || Array.isArray(result.timeline))
        intervalTraceScenarios += 1;
    }
    const completePairs = [...pairs.values()].filter(
      (pair) => pair.SELF_USE != null && pair.SMART != null,
    );
    return {
      runId: run.id,
      siteId: run.energySite.id,
      site: run.energySite.name,
      scenarios: run.scenarios.length,
      pairedScenarios: completePairs.length,
      smartWorseScenarios: completePairs.filter(
        (pair) => pair.SMART! > pair.SELF_USE! + 0.01,
      ).length,
      maxCostDifferenceCzk:
        Math.round(maxCostDifferenceCzk * 10_000) / 10_000,
      solverFallbackScenarios,
      intervalTraceScenarios,
    };
  });

  const report = {
    checkedAt: new Date().toISOString(),
    centralCostsConfigured: Boolean(
      process.env.COSTS_INTERNAL_API_URL && process.env.COSTS_INTERNAL_API_KEY,
    ),
    backendMarketConfigured: Boolean(
      process.env.SPOTTEX_BACKEND_DATABASE_URL,
    ),
    catalog: {
      productVersions: productVersions.length,
      productVersionsWithSource: productVersions.filter(
        (version) => version.sourceDocumentId,
      ).length,
      distributionVersions: distributionVersions.length,
      distributionVersionsWithSource: distributionVersions.filter(
        (version) => version.sourceDocumentId,
      ).length,
    },
    marketSeries: marketSeries
      ? {
          ...marketSeries,
          confirmedPoints: confirmedMarket?._count ?? 0,
          confirmedTo: confirmedMarket?._max.endAt ?? null,
          predictedPoints: predictedMarket?._count ?? 0,
          predictedTo: predictedMarket?._max.endAt ?? null,
        }
      : null,
    analyses: runReports,
  };
  const criticalFailures = [
    ...(report.catalog.productVersionsWithSource < report.catalog.productVersions
      ? ["PUBLISHED_PRODUCTS_WITHOUT_ARCHIVED_SOURCE"]
      : []),
    ...(report.catalog.distributionVersionsWithSource <
    report.catalog.distributionVersions
      ? ["PUBLISHED_DISTRIBUTIONS_WITHOUT_ARCHIVED_SOURCE"]
      : []),
    ...(runReports.some((run) => run.smartWorseScenarios > 0)
      ? ["SMART_WORSE_THAN_SELF_USE"]
      : []),
    ...(runReports.some((run) => run.maxCostDifferenceCzk > 0.1)
      ? ["ANNUAL_COST_IDENTITY_FAILED"]
      : []),
    ...(runReports.some((run) => run.solverFallbackScenarios > 0)
      ? ["SOLVER_FALLBACK_USED"]
      : []),
  ];
  const warnings = [
    ...(!report.centralCostsConfigured ? ["CENTRAL_COSTS_NOT_CONFIGURED"] : []),
    ...(!report.backendMarketConfigured ? ["BACKEND_MARKET_SYNC_NOT_CONFIGURED"] : []),
    ...(confirmedMarket?._max.endAt &&
    Date.now() - confirmedMarket._max.endAt.getTime() > 36 * 3_600_000
      ? ["OTE_MARKET_SERIES_IS_STALE"]
      : []),
    ...(marketSeries && (predictedMarket?._count ?? 0) === 0
      ? ["OTE_MARKET_FORECAST_NOT_IMPORTED"]
      : []),
    ...(runReports.some((run) => run.intervalTraceScenarios < run.scenarios)
      ? ["INTERVAL_SIMULATION_TRACE_NOT_PERSISTED"]
      : []),
  ];
  console.log(
    JSON.stringify(
      { status: criticalFailures.length ? "FAILED" : warnings.length ? "WARNING" : "PASSED", criticalFailures, warnings, ...report },
      null,
      2,
    ),
  );
  if (criticalFailures.length) process.exitCode = 1;
}

main()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
