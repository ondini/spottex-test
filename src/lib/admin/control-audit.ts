import "server-only";

import { EnergyIntervalKind, Prisma } from "@prisma/client";

import { getAnalysisInputSeries } from "@/lib/analysis/detail";
import {
  getEnergyDataQuality,
  type EnergyDataQuality,
} from "@/lib/energy/data-quality";
import { prisma } from "@/lib/prisma";
import {
  MS_VETRNIK_REPLAY,
  type ControlAuditReplay,
} from "@/lib/admin/control-audit-replay";

export type AuditTone = "success" | "warning" | "danger" | "neutral";

export type ControlAuditCheck = {
  title: string;
  detail: string;
  tone: AuditTone;
  status: string;
};

export type ControlAudit = {
  sites: Array<{ id: number; name: string; owner: string }>;
  site: {
    id: number;
    name: string;
    owner: string;
    externalSiteId: string;
    optimizationOn: boolean;
    requiredInfo: boolean;
    lastSyncedAt: string | null;
  };
  inverters: Array<{
    id: number;
    externalDeviceId: string;
    name: string;
    status: string;
    measuredIntervals: number;
    predictedIntervals: number;
    productionKwh: number;
    consumptionKwh: number;
    firstMeasuredAt: string | null;
    lastMeasuredAt: string | null;
  }>;
  quality: EnergyDataQuality;
  dailySeries: Array<{
    date: string;
    productionKwh: number;
    consumptionKwh: number;
    intervals: number;
  }>;
  coverageTimeline: Array<{
    date: string;
    state: "BOTH" | "ONE" | "PARTIAL" | "NONE";
    activeInverters: number;
    suspiciousZeroProduction: boolean;
    productionKwh: number;
    consumptionKwh: number;
    inverters: Array<{
      inverterId: number;
      productionIntervals: number;
      consumptionIntervals: number;
      state: "FULL" | "PARTIAL" | "NONE";
    }>;
  }>;
  coverageSummary: {
    bothDays: number;
    oneDays: number;
    partialDays: number;
    noDataDays: number;
  };
  anomaly: {
    zeroProductionDays: number;
    longestZeroProductionStreak: number;
    nightProductionIntervals: number;
    nightProductionKwh: number;
  };
  forecast: {
    currentPredictionIntervals: number;
    reclassifiedCandidates: number;
    exactReclassificationPercent: number | null;
    verifiableSamples: number;
    productionMaeKwh: number | null;
    consumptionMaeKwh: number | null;
    reason: string;
  };
  replay: ControlAuditReplay | null;
  control: {
    schedules: number;
    commands: number;
    acknowledgedCommands: number;
    failedCommands: number;
    latestScheduleAt: string | null;
    latestCommandAt: string | null;
  };
  tariff: {
    complete: boolean;
    missing: string[];
    distributionTariffCode: string | null;
    buyMode: string | null;
    sellMode: string | null;
    supplier: string | null;
    product: string | null;
    priceCurves: number;
    readyPriceCurves: number;
    referencedCatalogVersions: number;
    sourceBackedCatalogVersions: number;
  };
  analysis: {
    latestRunId: string | null;
    status: string | null;
    engineVersion: string | null;
    methodologyVersion: string | null;
    completedAt: string | null;
    scenarios: number;
    pairedScenarios: number;
    smartWorseScenarios: number;
    minSmartSavingCzk: number | null;
    maxSmartSavingCzk: number | null;
    maxCostDecompositionDifferenceCzk: number | null;
  };
  training: {
    historicalIntervals: number;
    completeDays: number;
    enoughHistoryForSplit: boolean;
    forecastLabelsReady: boolean;
    recommendation: string;
  };
  checks: ControlAuditCheck[];
};

type InverterDailyCoverage = {
  inverterId: number;
  date: string;
  productionIntervals: number;
  consumptionIntervals: number;
  productionKwh: number;
  consumptionKwh: number;
};

type InverterIntervalSummary = {
  inverterId: number;
  measuredIntervals: number;
  predictedIntervals: number;
  productionKwh: number;
  consumptionKwh: number;
  firstMeasuredAt: Date | null;
  lastMeasuredAt: Date | null;
};

type NightProductionSummary = {
  intervals: number;
  kwh: number;
};

function round(value: number, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function nullableNumber(value: Prisma.Decimal | number | null | undefined) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function localDateKey(value: Date, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function longestStreak(values: boolean[]) {
  let current = 0;
  let longest = 0;
  for (const value of values) {
    current = value ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

function eachDate(from: string, to: string) {
  const values: string[] = [];
  const cursor = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (cursor <= end) {
    values.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return values;
}

function scenarioPairKey(value: string) {
  return value.replace(/:(SELF_USE|SMART)$/i, "");
}

export async function getControlAudit(requestedSiteId?: number): Promise<ControlAudit | null> {
  const siteOptions = await prisma.energySite.findMany({
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      user: { select: { email: true } },
    },
  });
  if (!siteOptions.length) return null;
  const selectedId = siteOptions.some((site) => site.id === requestedSiteId)
    ? requestedSiteId!
    : siteOptions[0].id;
  const from = new Date(Date.now() - 370 * 86_400_000);

  const site = await prisma.energySite.findUnique({
    where: { id: selectedId },
    include: {
      user: { select: { email: true } },
      inverters: { orderBy: { id: "asc" } },
      technicalProfile: true,
    },
  });
  if (!site) return null;
  const inverterIds = site.inverters.map((inverter) => inverter.id);

  const [
    quality,
    inputSeries,
    dailyCoverageRows,
    inverterSummaryRows,
    nightProductionRows,
    currentPredictionIntervals,
    forecastCorrections,
    forecastSnapshots,
    schedules,
    commands,
    priceCurves,
    latestRun,
  ] = await Promise.all([
    getEnergyDataQuality(site.userId, selectedId),
    getAnalysisInputSeries(site.userId, selectedId, {
      from,
      to: new Date(),
      resolution: "DAY",
    }),
    prisma.$queryRaw<InverterDailyCoverage[]>(Prisma.sql`
      SELECT
        "inverterId",
        to_char(
          date_trunc(
            'day',
            ("startAt" AT TIME ZONE 'UTC') AT TIME ZONE ${site.timezone}
          ),
          'YYYY-MM-DD'
        ) AS date,
        COUNT(*) FILTER (
          WHERE "kind"::text = 'PRODUCTION' AND "predicted" = false
        )::integer AS "productionIntervals",
        COUNT(*) FILTER (
          WHERE "kind"::text = 'CONSUMPTION' AND "predicted" = false
        )::integer AS "consumptionIntervals",
        COALESCE(SUM("kwh") FILTER (
          WHERE "kind"::text = 'PRODUCTION' AND "predicted" = false
        ), 0)::double precision AS "productionKwh",
        COALESCE(SUM("kwh") FILTER (
          WHERE "kind"::text = 'CONSUMPTION' AND "predicted" = false
        ), 0)::double precision AS "consumptionKwh"
      FROM "general"."energy_interval"
      WHERE "inverterId" IN (${Prisma.join(inverterIds)})
        AND "startAt" >= ${from}
        AND "kind"::text IN ('PRODUCTION', 'CONSUMPTION')
      GROUP BY "inverterId", date
      ORDER BY date ASC, "inverterId" ASC
    `),
    prisma.$queryRaw<InverterIntervalSummary[]>(Prisma.sql`
      SELECT
        "inverterId",
        COUNT(*) FILTER (WHERE "predicted" = false)::integer AS "measuredIntervals",
        COUNT(*) FILTER (WHERE "predicted" = true)::integer AS "predictedIntervals",
        COALESCE(SUM("kwh") FILTER (
          WHERE "predicted" = false AND "kind"::text = 'PRODUCTION'
        ), 0)::double precision AS "productionKwh",
        COALESCE(SUM("kwh") FILTER (
          WHERE "predicted" = false AND "kind"::text = 'CONSUMPTION'
        ), 0)::double precision AS "consumptionKwh",
        MIN("startAt") FILTER (WHERE "predicted" = false) AS "firstMeasuredAt",
        MAX("startAt") FILTER (WHERE "predicted" = false) AS "lastMeasuredAt"
      FROM "general"."energy_interval"
      WHERE "inverterId" IN (${Prisma.join(inverterIds)})
        AND "startAt" >= ${from}
        AND "kind"::text IN ('PRODUCTION', 'CONSUMPTION', 'BATTERY', 'GRID_IMPORT', 'GRID_EXPORT')
      GROUP BY "inverterId"
    `),
    prisma.$queryRaw<NightProductionSummary[]>(Prisma.sql`
      SELECT
        COUNT(*)::integer AS intervals,
        COALESCE(SUM("kwh"), 0)::double precision AS kwh
      FROM "general"."energy_interval"
      WHERE "inverterId" IN (${Prisma.join(inverterIds)})
        AND "startAt" >= ${from}
        AND "predicted" = false
        AND "kind"::text = 'PRODUCTION'
        AND "kwh" > 0.01
        AND (
          EXTRACT(
            HOUR FROM (("startAt" AT TIME ZONE 'UTC') AT TIME ZONE ${site.timezone})
          ) >= 22
          OR EXTRACT(
            HOUR FROM (("startAt" AT TIME ZONE 'UTC') AT TIME ZONE ${site.timezone})
          ) < 5
        )
    `),
    prisma.energyInterval.count({
      where: {
        inverterId: { in: inverterIds },
        predicted: true,
        startAt: { gte: from },
      },
    }),
    prisma.energyIntervalCorrection.findMany({
      where: {
        originalPredicted: true,
        correctedPredicted: false,
        interval: {
          inverter: { energySiteId: selectedId },
          kind: {
            in: [
              EnergyIntervalKind.PRODUCTION,
              EnergyIntervalKind.CONSUMPTION,
            ],
          },
        },
      },
      select: {
        originalKwh: true,
        correctedKwh: true,
        createdAt: true,
        interval: {
          select: {
            kind: true,
            startAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 10_000,
    }),
    prisma.energyForecastSnapshot.findMany({
      where: {
        inverter: { energySiteId: selectedId },
        actualKwh: { not: null },
        horizonMinutes: { gte: 60 },
        kind: {
          in: [
            EnergyIntervalKind.PRODUCTION,
            EnergyIntervalKind.CONSUMPTION,
          ],
        },
      },
      select: {
        kind: true,
        predictedKwh: true,
        actualKwh: true,
        generatedAt: true,
        targetStartAt: true,
        modelVersion: true,
      },
      orderBy: { targetStartAt: "desc" },
      take: 20_000,
    }),
    prisma.inverterSchedule.findMany({
      where: { inverterId: { in: inverterIds } },
      select: { startAt: true },
      orderBy: { startAt: "desc" },
      take: 10_000,
    }),
    prisma.inverterCommand.findMany({
      where: { inverterId: { in: inverterIds } },
      select: { status: true, requestedAt: true },
      orderBy: { requestedAt: "desc" },
      take: 10_000,
    }),
    prisma.energyPriceCurve.findMany({
      where: { energySiteId: selectedId },
      select: { status: true },
    }),
    prisma.energyAnalysisRun.findFirst({
      where: { energySiteId: selectedId },
      orderBy: { createdAt: "desc" },
      include: {
        scenarios: {
          select: {
            scenarioKey: true,
            controlMode: true,
            annualCostCzk: true,
            annualImportCostCzk: true,
            annualExportRevenueCzk: true,
            annualFixedCostCzk: true,
            priceCurve: {
              select: {
                buyProductVersion: { select: { id: true, sourceDocumentId: true } },
                sellProductVersion: { select: { id: true, sourceDocumentId: true } },
                distributionVersion: { select: { id: true, sourceDocumentId: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  const dailySeries = inputSeries.series.map((value) => ({
    date: localDateKey(new Date(value.at), site.timezone),
    productionKwh: value.productionKwh,
    consumptionKwh: value.consumptionKwh,
    intervals: value.intervals,
  }));
  const coverageByDate = new Map<
    string,
    Map<
      number,
      {
        productionIntervals: number;
        consumptionIntervals: number;
        productionKwh: number;
        consumptionKwh: number;
      }
    >
  >();
  for (const row of dailyCoverageRows) {
    const byInverter = coverageByDate.get(row.date) ?? new Map();
    byInverter.set(row.inverterId, {
      productionIntervals: row.productionIntervals,
      consumptionIntervals: row.consumptionIntervals,
      productionKwh: row.productionKwh,
      consumptionKwh: row.consumptionKwh,
    });
    coverageByDate.set(row.date, byInverter);
  }
  const coverageDates = [...coverageByDate.keys()].sort();
  const coverageTimeline =
    coverageDates.length === 0
      ? []
      : eachDate(coverageDates[0], coverageDates.at(-1)!).map((date) => {
          const byInverter = coverageByDate.get(date) ?? new Map();
          const inverterCoverage = site.inverters.map((inverter) => {
            const value = byInverter.get(inverter.id) ?? {
              productionIntervals: 0,
              consumptionIntervals: 0,
              productionKwh: 0,
              consumptionKwh: 0,
            };
            const minimum = Math.min(
              value.productionIntervals,
              value.consumptionIntervals,
            );
            return {
              inverterId: inverter.id,
              productionIntervals: value.productionIntervals,
              consumptionIntervals: value.consumptionIntervals,
              productionKwh: value.productionKwh,
              consumptionKwh: value.consumptionKwh,
              state:
                minimum >= 80
                  ? ("FULL" as const)
                  : value.productionIntervals > 0 ||
                      value.consumptionIntervals > 0
                    ? ("PARTIAL" as const)
                    : ("NONE" as const),
            };
          });
          const activeInverters = inverterCoverage.filter(
            (value) => value.state === "FULL",
          ).length;
          const productionKwh = inverterCoverage.reduce(
            (sum, value) => sum + value.productionKwh,
            0,
          );
          const consumptionKwh = inverterCoverage.reduce(
            (sum, value) => sum + value.consumptionKwh,
            0,
          );
          const hasPartial = inverterCoverage.some(
            (value) => value.state === "PARTIAL",
          );
          return {
            date,
            state:
              activeInverters === site.inverters.length
                ? ("BOTH" as const)
                : activeInverters > 0
                  ? ("ONE" as const)
                  : hasPartial
                    ? ("PARTIAL" as const)
                    : ("NONE" as const),
            activeInverters,
            suspiciousZeroProduction:
              activeInverters > 0 &&
              consumptionKwh >= 0.5 &&
              productionKwh < 0.1,
            productionKwh: round(productionKwh, 3),
            consumptionKwh: round(consumptionKwh, 3),
            inverters: inverterCoverage.map(
              ({
                inverterId,
                productionIntervals,
                consumptionIntervals,
                state,
              }) => ({
                inverterId,
                productionIntervals,
                consumptionIntervals,
                state,
              }),
            ),
          };
        });
  const coverageSummary = {
    bothDays: coverageTimeline.filter((day) => day.state === "BOTH").length,
    oneDays: coverageTimeline.filter((day) => day.state === "ONE").length,
    partialDays: coverageTimeline.filter((day) => day.state === "PARTIAL").length,
    noDataDays: coverageTimeline.filter((day) => day.state === "NONE").length,
  };
  const zeroProduction = dailySeries.map(
    (day) =>
      day.intervals >= 80 &&
      day.consumptionKwh >= 0.5 &&
      day.productionKwh < 0.1,
  );
  const nightProduction = nightProductionRows[0] ?? { intervals: 0, kwh: 0 };

  const forecastCandidateCount = forecastCorrections.length;
  const exactCandidates = forecastCorrections.filter(
    (item) => Math.abs(item.originalKwh - item.correctedKwh) < 1e-9,
  ).length;
  const verifiableForecasts = forecastSnapshots.filter(
    (
      snapshot,
    ): snapshot is typeof snapshot & { actualKwh: number } =>
      snapshot.actualKwh != null &&
      snapshot.targetStartAt > snapshot.generatedAt &&
      snapshot.modelVersion !== "LEGACY_UNVERSIONED",
  );
  const forecastMae = (kind: EnergyIntervalKind) => {
    const values = verifiableForecasts.filter(
      (snapshot) => snapshot.kind === kind,
    );
    if (!values.length) return null;
    return round(
      values.reduce(
        (sum, snapshot) =>
          sum + Math.abs(snapshot.predictedKwh - snapshot.actualKwh),
        0,
      ) / values.length,
      4,
    );
  };

  const perInverter = site.inverters.map((inverter) => {
    const summary = inverterSummaryRows.find(
      (item) => item.inverterId === inverter.id,
    );
    return {
      id: inverter.id,
      externalDeviceId: inverter.externalDeviceId,
      name: inverter.name || inverter.model || `Střídač ${inverter.id}`,
      status: inverter.status,
      measuredIntervals: summary?.measuredIntervals ?? 0,
      predictedIntervals: summary?.predictedIntervals ?? 0,
      productionKwh: round(summary?.productionKwh ?? 0),
      consumptionKwh: round(summary?.consumptionKwh ?? 0),
      firstMeasuredAt: summary?.firstMeasuredAt?.toISOString() ?? null,
      lastMeasuredAt: summary?.lastMeasuredAt?.toISOString() ?? null,
    };
  });

  const profile = site.technicalProfile;
  const missingTariff: string[] = [];
  if (!profile?.distributionTariffCode) missingTariff.push("distribuční sazba");
  if (!profile?.distributorCode) missingTariff.push("distributor");
  if (!profile?.mainFuseA || !profile?.phases) missingTariff.push("jistič a počet fází");
  if (!profile?.buyPricingMode) {
    missingTariff.push("typ nákupu");
  } else if (
    profile.buyPricingMode.toUpperCase() === "SPOT"
      ? profile.spotBuyFeeCzkKwh == null
      : profile.fixedBuyPriceCzkKwh == null
  ) {
    missingTariff.push("nákupní cena / marže");
  }
  if (!profile?.sellPricingMode) {
    missingTariff.push("typ výkupu");
  } else if (
    profile.sellPricingMode.toUpperCase() === "SPOT"
      ? profile.spotSellFeeCzkKwh == null
      : profile.fixedSellPriceCzkKwh == null
  ) {
    missingTariff.push("výkupní cena / marže");
  }
  if (profile?.monthlySupplierFeeCzk == null) missingTariff.push("měsíční plat dodavateli");

  const paired = new Map<
    string,
    { selfUse: number | null; smart: number | null }
  >();
  let maxDecompositionDifference = 0;
  for (const scenario of latestRun?.scenarios ?? []) {
    const key = scenarioPairKey(scenario.scenarioKey);
    const pair = paired.get(key) ?? { selfUse: null, smart: null };
    const annualCost = nullableNumber(scenario.annualCostCzk);
    if (scenario.controlMode === "SELF_USE") pair.selfUse = annualCost;
    if (scenario.controlMode === "SMART") pair.smart = annualCost;
    paired.set(key, pair);
    const importCost = nullableNumber(scenario.annualImportCostCzk);
    const exportRevenue = nullableNumber(scenario.annualExportRevenueCzk);
    const fixedCost = nullableNumber(scenario.annualFixedCostCzk);
    if (
      annualCost != null &&
      importCost != null &&
      exportRevenue != null &&
      fixedCost != null
    ) {
      maxDecompositionDifference = Math.max(
        maxDecompositionDifference,
        Math.abs(annualCost - (importCost - exportRevenue + fixedCost)),
      );
    }
  }
  const completePairs = [...paired.values()].filter(
    (pair): pair is { selfUse: number; smart: number } =>
      pair.selfUse != null && pair.smart != null,
  );
  const savings = completePairs.map((pair) => pair.selfUse - pair.smart);
  const referencedCatalog = new Map<string, boolean>();
  for (const scenario of latestRun?.scenarios ?? []) {
    const buy = scenario.priceCurve.buyProductVersion;
    const sell = scenario.priceCurve.sellProductVersion;
    const distribution = scenario.priceCurve.distributionVersion;
    if (buy) referencedCatalog.set(`product:${buy.id}`, Boolean(buy.sourceDocumentId));
    if (sell) referencedCatalog.set(`product:${sell.id}`, Boolean(sell.sourceDocumentId));
    if (distribution)
      referencedCatalog.set(
        `distribution:${distribution.id}`,
        Boolean(distribution.sourceDocumentId),
      );
  }
  const sourceBackedCatalogVersions = [...referencedCatalog.values()].filter(Boolean).length;
  const smartWorseScenarios = savings.filter((saving) => saving < -0.01).length;
  const analysis = {
    latestRunId: latestRun?.id ?? null,
    status: latestRun?.status ?? null,
    engineVersion: latestRun?.engineVersion ?? null,
    methodologyVersion: latestRun?.methodologyVersion ?? null,
    completedAt: latestRun?.completedAt?.toISOString() ?? null,
    scenarios: latestRun?.scenarios.length ?? 0,
    pairedScenarios: completePairs.length,
    smartWorseScenarios,
    minSmartSavingCzk: savings.length ? round(Math.min(...savings)) : null,
    maxSmartSavingCzk: savings.length ? round(Math.max(...savings)) : null,
    maxCostDecompositionDifferenceCzk: latestRun
      ? round(maxDecompositionDifference)
      : null,
  };

  const control = {
    schedules: schedules.length,
    commands: commands.length,
    acknowledgedCommands: commands.filter((command) => command.status === "ACKNOWLEDGED").length,
    failedCommands: commands.filter((command) => command.status === "FAILED").length,
    latestScheduleAt: schedules[0]?.startAt.toISOString() ?? null,
    latestCommandAt: commands[0]?.requestedAt.toISOString() ?? null,
  };
  const checks: ControlAuditCheck[] = [
    {
      title: "Provedení řízení",
      status: !site.optimizationOn
        ? "Řízení vypnuto"
        : control.schedules > 0 && control.commands > 0
          ? "Existují důkazy"
          : "Chybí důkazy",
      tone: !site.optimizationOn
        ? "neutral"
        : control.schedules > 0 && control.commands > 0
          ? "success"
          : "danger",
      detail: !site.optimizationOn
        ? "Elektrárna nyní není řízena. Výsledky analýzy jsou simulace, ne audit vykonaných povelů."
        : `Uloženo ${control.schedules} plánů a ${control.commands} uživatelských povelů. Pro úplný audit musí navazovat plán, odeslání, potvrzení a telemetrie.`,
    },
    {
      title: "Predikce proti realitě",
      status: verifiableForecasts.length > 0 ? "Ověřitelné" : "Zatím bez vzorků",
      tone: verifiableForecasts.length > 0 ? "success" : "warning",
      detail:
        verifiableForecasts.length > 0
          ? `Uloženo ${verifiableForecasts.length} nezávislých snapshotů s horizontem alespoň 60 minut.`
          : "Ukládání neměnných forecast snapshotů je zapnuté, první ověřitelné vzorky vzniknou po příchodu cílových měření.",
    },
    {
      title: "Pokrytí všech střídačů",
      status:
        perInverter.length <= 1 ||
        perInverter.every(
          (inverter) =>
            inverter.firstMeasuredAt &&
            inverter.lastMeasuredAt &&
            (new Date(inverter.lastMeasuredAt).getTime() -
              new Date(inverter.firstMeasuredAt).getTime()) /
              86_400_000 >=
              quality.spanDays * 0.75,
        )
          ? "Souměřitelné"
          : "Historie zařízení se liší",
      tone:
        perInverter.length <= 1 ||
        perInverter.every(
          (inverter) =>
            inverter.firstMeasuredAt &&
            inverter.lastMeasuredAt &&
            (new Date(inverter.lastMeasuredAt).getTime() -
              new Date(inverter.firstMeasuredAt).getTime()) /
              86_400_000 >=
              quality.spanDays * 0.75,
        )
          ? "success"
          : "danger",
      detail:
        perInverter.length <= 1
          ? "Elektrárna má jeden datový zdroj."
          : "Výroba a odvozená spotřeba se sčítají přes všechna zařízení. Pokud některému chybí historie, celkový profil je systematicky podhodnocený.",
    },
    {
      title: "Fyzikální energetická bilance",
      status:
        quality.balanceEvaluatedIntervals === 0
          ? "Nelze vyhodnotit"
          : quality.balanceInvalidIntervals /
                quality.balanceEvaluatedIntervals <=
              0.05
            ? "Sedí"
            : "Mimo toleranci",
      tone:
        quality.balanceEvaluatedIntervals === 0
          ? "warning"
          : quality.balanceInvalidIntervals /
                quality.balanceEvaluatedIntervals <=
              0.05
            ? "success"
            : "danger",
      detail:
        quality.balanceEvaluatedIntervals === 0
          ? "Chybí společné intervaly výroby, spotřeby, baterie a sítě."
          : `${quality.balanceInvalidIntervals.toLocaleString("cs-CZ")} z ${quality.balanceEvaluatedIntervals.toLocaleString("cs-CZ")} úplných intervalů nesplňuje bilanční toleranci 5 %.`,
    },
    {
      title: "Úplnost tarifu",
      status: missingTariff.length ? `${missingTariff.length} částí chybí` : "Kompletní",
      tone: missingTariff.length ? "warning" : "success",
      detail: missingTariff.length
        ? `Bez položek ${missingTariff.join(", ")} nelze ověřit skutečnou korunu na faktuře.`
        : "Nákup, výkup, distribuce, jistič a stálé platby jsou zadané.",
    },
    {
      title: "Finanční bilance analýzy",
      status:
        analysis.maxCostDecompositionDifferenceCzk != null &&
        analysis.maxCostDecompositionDifferenceCzk <= 0.05
          ? "Součet sedí"
          : "Vyžaduje kontrolu",
      tone:
        analysis.maxCostDecompositionDifferenceCzk != null &&
        analysis.maxCostDecompositionDifferenceCzk <= 0.05
          ? "success"
          : "warning",
      detail:
        analysis.maxCostDecompositionDifferenceCzk == null
          ? "Není dokončený výpočet s rozkladem nákupu, výkupu a stálých plateb."
          : `Nejvyšší rozdíl ročního součtu je ${analysis.maxCostDecompositionDifferenceCzk.toLocaleString("cs-CZ")} Kč.`,
    },
    {
      title: "Původ použitých ceníků",
      status:
        referencedCatalog.size > 0 &&
        sourceBackedCatalogVersions === referencedCatalog.size
          ? "Doložené zdroje"
          : `${referencedCatalog.size - sourceBackedCatalogVersions} bez dokumentu`,
      tone:
        referencedCatalog.size > 0 &&
        sourceBackedCatalogVersions === referencedCatalog.size
          ? "success"
          : "danger",
      detail:
        referencedCatalog.size === 0
          ? "Poslední analýza neobsahuje dohledatelné verze produktu a distribuce."
          : `${sourceBackedCatalogVersions} z ${referencedCatalog.size} unikátních produktových a distribučních verzí použitých v poslední analýze má archivovaný oficiální dokument.`,
    },
    {
      title: "Smart vs. self-use",
      status:
        analysis.pairedScenarios === 0
          ? "Bez párového testu"
          : smartWorseScenarios === 0
            ? "Smart nezhoršuje"
            : `${smartWorseScenarios} horších variant`,
      tone:
        analysis.pairedScenarios === 0
          ? "warning"
          : smartWorseScenarios === 0
            ? "success"
            : "danger",
      detail:
        analysis.pairedScenarios === 0
          ? "Chybí stejné tarifní scénáře spočítané v obou režimech."
          : `Porovnáno ${analysis.pairedScenarios} shodných tarifních variant z posledního běhu.`,
    },
    {
      title: "FIX/FIX ceny",
      status: "Explicitní nákup i výkup",
      tone: "success",
      detail:
        "Opravený výpočet používá samostatnou fixní nákupní cenu a samostatnou fixní výkupní cenu. Výnos z přetoků není odvozen z nákupní ceny ani nahrazen obecnou penalizací.",
    },
    {
      title: "Záporné spotové ceny",
      status: "Nákup zachován · výkup blokován",
      tone: "warning",
      detail:
        "Záporná nákupní cena je platný a výhodný vstup, proto se neořezává. Záporná konečná výkupní cena naopak dostává explicitní zákaz exportu v optimalizéru i nulový exportní limit ve vysílači povelů. Opravu je nutné nasadit do živého legacy workeru.",
    },
  ];

  return {
    sites: siteOptions.map((item) => ({
      id: item.id,
      name: item.name,
      owner: item.user.email,
    })),
    site: {
      id: site.id,
      name: site.name,
      owner: site.user.email,
      externalSiteId: site.externalSiteId,
      optimizationOn: site.optimizationOn,
      requiredInfo: site.requiredInfo,
      lastSyncedAt: site.lastSyncedAt?.toISOString() ?? null,
    },
    inverters: perInverter,
    quality,
    dailySeries,
    coverageTimeline,
    coverageSummary,
    anomaly: {
      zeroProductionDays: zeroProduction.filter(Boolean).length,
      longestZeroProductionStreak: longestStreak(zeroProduction),
      nightProductionIntervals: nightProduction.intervals,
      nightProductionKwh: round(nightProduction.kwh, 3),
    },
    forecast: {
      currentPredictionIntervals,
      reclassifiedCandidates: forecastCandidateCount,
      exactReclassificationPercent: forecastCandidateCount
        ? round((exactCandidates / forecastCandidateCount) * 100, 1)
        : null,
      verifiableSamples: verifiableForecasts.length,
      productionMaeKwh: forecastMae(EnergyIntervalKind.PRODUCTION),
      consumptionMaeKwh: forecastMae(EnergyIntervalKind.CONSUMPTION),
      reason:
        verifiableForecasts.length > 0
          ? "MAE je počítané pouze z neměnných snapshotů vytvořených nejméně 60 minut před cílovým intervalem."
          : "Starší kandidáti neobsahují okamžik vzniku ani verzi modelu. Téměř přesná shoda ukazuje na přeznačení naměřeného intervalu, ne na nezávislou předpověď.",
    },
    replay:
      site.externalSiteId === "34" || site.name.toLowerCase().includes("vetrnik")
        ? MS_VETRNIK_REPLAY
        : null,
    control,
    tariff: {
      complete: missingTariff.length === 0,
      missing: missingTariff,
      distributionTariffCode: profile?.distributionTariffCode ?? null,
      buyMode: profile?.buyPricingMode ?? null,
      sellMode: profile?.sellPricingMode ?? null,
      supplier: profile?.currentSupplierName ?? null,
      product: profile?.currentProductName ?? null,
      priceCurves: priceCurves.length,
      readyPriceCurves: priceCurves.filter((curve) => curve.status === "READY").length,
      referencedCatalogVersions: referencedCatalog.size,
      sourceBackedCatalogVersions,
    },
    analysis,
    training: {
      historicalIntervals: quality.matchedIntervals,
      completeDays: Math.floor(quality.coverageDays),
      enoughHistoryForSplit: quality.coverageDays >= 90,
      forecastLabelsReady: verifiableForecasts.length >= 30 * 96,
      recommendation:
        quality.coverageDays < 90
          ? "Nejdřív doplnit alespoň 90 úplných dní a odstranit datové mezery."
          : zeroProduction.filter(Boolean).length > 7
            ? "Historie stačí pro časový train/validation split, ale před učením je nutné vyřešit dlouhé úseky nulové výroby."
            : "Historie stačí pro rolling backtest. Ukládejte forecast snapshoty a model povyšte až po zlepšení proti sezónnímu baseline.",
    },
    checks,
  };
}
