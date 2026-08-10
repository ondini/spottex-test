import "server-only";

import { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { breakerMonthlyFee } from "@/lib/pricing/materialize";
function number(value: Prisma.Decimal | number | null | undefined) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function object(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function localDateKey(date: Date, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export async function getAnalysisInputSeries(
  userId: number,
  siteId: number,
  options: {
    from?: Date;
    to?: Date;
    resolution?: "WEEK" | "DAY" | "HOUR" | "15MIN";
  } = {},
) {
  const site = await prisma.energySite.findFirst({
    where: { id: siteId, userId },
    include: {
      inverters: { orderBy: { id: "asc" } },
    },
  });
  if (!site) throw new Error("ANALYSIS_SITE_NOT_FOUND");
  const inverter = site.inverters[0];
  if (!inverter) throw new Error("ANALYSIS_INVERTER_NOT_FOUND");
  const to = options.to ?? new Date();
  const from =
    options.from ?? new Date(to.getTime() - 366 * 86_400_000);
  const resolution = options.resolution ?? "WEEK";
  type AggregatedRow = {
    at: Date;
    productionKwh: number;
    consumptionKwh: number;
    gridImportKwh: number;
    gridExportKwh: number;
    batteryKwh: number;
    intervals: number;
    gridIntervals: number;
  };
  const bucket =
    resolution === "WEEK"
      ? Prisma.sql`date_trunc('week', ("startAt" AT TIME ZONE 'UTC') AT TIME ZONE ${site.timezone}) AT TIME ZONE ${site.timezone}`
      : resolution === "DAY"
        ? Prisma.sql`date_trunc('day', ("startAt" AT TIME ZONE 'UTC') AT TIME ZONE ${site.timezone}) AT TIME ZONE ${site.timezone}`
        : resolution === "HOUR"
          ? Prisma.sql`date_trunc('hour', "startAt")`
          : Prisma.sql`"startAt"`;
  // Aggregate all inverters and physical channels in PostgreSQL. The previous
  // implementation transferred more than 100k rows for a one-year chart and
  // reduced them to a few hundred points in Node.js.
  const rows = await prisma.$queryRaw<AggregatedRow[]>(Prisma.sql`
    WITH site_intervals AS (
      SELECT
        "startAt",
        MAX("endAt") AS "endAt",
        SUM("kwh") FILTER (WHERE "kind"::text = 'PRODUCTION') AS production,
        SUM("kwh") FILTER (WHERE "kind"::text = 'CONSUMPTION') AS consumption,
        SUM("kwh") FILTER (WHERE "kind"::text = 'BATTERY') AS battery,
        SUM("kwh") FILTER (WHERE "kind"::text = 'GRID_IMPORT') AS grid_import,
        SUM("kwh") FILTER (WHERE "kind"::text = 'GRID_EXPORT') AS grid_export
      FROM "general"."energy_interval"
      WHERE "inverterId" IN (${Prisma.join(site.inverters.map((item) => item.id))})
        AND "predicted" = false
        AND "startAt" >= ${from}
        AND "startAt" < ${to}
        AND "kind"::text IN ('PRODUCTION', 'CONSUMPTION', 'BATTERY', 'GRID_IMPORT', 'GRID_EXPORT')
      GROUP BY "startAt"
    ), physical_load AS (
      SELECT
        "startAt",
        production,
        CASE
          WHEN grid_import IS NOT NULL AND grid_export IS NOT NULL AND battery IS NOT NULL
            AND (
              consumption IS NULL OR
              ABS(consumption - GREATEST(0, production + grid_import + battery - grid_export)) >
                GREATEST(
                  0.05,
                  GREATEST(consumption, GREATEST(0, production + grid_import + battery - grid_export), 0) * 0.05
                )
            )
          THEN GREATEST(0, production + grid_import + battery - grid_export)
          ELSE consumption
        END AS consumption,
        grid_import,
        grid_export,
        battery
      FROM site_intervals
      WHERE production IS NOT NULL
    ), bucketed AS (
      SELECT ${bucket} AS bucket_at, *
      FROM physical_load
      WHERE consumption IS NOT NULL AND consumption >= -0.000001
    )
    SELECT
      bucket_at AS "at",
      SUM(production)::double precision AS "productionKwh",
      SUM(consumption)::double precision AS "consumptionKwh",
      COALESCE(SUM(grid_import), 0)::double precision AS "gridImportKwh",
      COALESCE(SUM(grid_export), 0)::double precision AS "gridExportKwh",
      COALESCE(SUM(battery), 0)::double precision AS "batteryKwh",
      COUNT(*)::integer AS intervals,
      COUNT(*) FILTER (
        WHERE grid_import IS NOT NULL AND grid_export IS NOT NULL
      )::integer AS "gridIntervals"
    FROM bucketed
    GROUP BY bucket_at
    ORDER BY bucket_at ASC
  `);
  const round = (value: number) => Math.round(value * 1_000) / 1_000;
  const normalizedRows = rows.map((row) => ({
    ...row,
    at: row.at.toISOString(),
    productionKwh: round(row.productionKwh),
    consumptionKwh: round(row.consumptionKwh),
    gridImportKwh: round(row.gridImportKwh),
    gridExportKwh: round(row.gridExportKwh),
    batteryKwh: round(row.batteryKwh),
  }));
  const normalizedSeries = normalizedRows
    .filter(
      (point) =>
        resolution !== "DAY" ||
        options.from != null ||
        point.intervals >= 92,
    )
    .map((point) => ({
      at: point.at,
      productionKwh: point.productionKwh,
      consumptionKwh: point.consumptionKwh,
      intervals: point.intervals,
    }));
  return {
    site: { id: site.id, name: site.name, timezone: site.timezone },
    resolution,
    range: { from: from.toISOString(), to: to.toISOString() },
    series: normalizedSeries,
    inverter: {
      id: inverter.id,
      name:
        site.inverters.length > 1
          ? `${site.inverters.length} střídače`
          : inverter.name,
      status: inverter.status,
      lastSeenAt: inverter.lastSeenAt?.toISOString() ?? null,
    },
    daily:
      resolution === "DAY"
        ? normalizedRows
            .filter((item) => item.intervals >= 92)
            .map((item) => ({
              date: localDateKey(new Date(item.at), site.timezone),
              productionKwh: item.productionKwh,
              consumptionKwh: item.consumptionKwh,
              gridImportKwh: item.gridImportKwh,
              gridExportKwh: item.gridExportKwh,
              batteryKwh: item.batteryKwh,
              completeIntervals: item.intervals,
              gridIntervals: item.gridIntervals,
            }))
        : [],
  };
}

const periodSchema = z.object({
  key: z.string(),
  intervals: z.number().int().nonnegative(),
  importKwh: z.number(),
  exportKwh: z.number(),
  chargedKwh: z.number(),
  dischargedKwh: z.number(),
  importCostCzk: z.number(),
  exportRevenueCzk: z.number(),
  variableCostCzk: z.number(),
});

function scenarioEvidence(value: {
  id: string;
  controlMode: "SELF_USE" | "SMART";
  status: string;
  annualCostCzk: Prisma.Decimal | null;
  annualImportCostCzk: Prisma.Decimal | null;
  annualExportRevenueCzk: Prisma.Decimal | null;
  annualFixedCostCzk: Prisma.Decimal | null;
  result: Prisma.JsonValue;
}) {
  const result = object(value.result);
  const periods = object(result.periods as Prisma.JsonValue);
  const monthly = z
    .array(periodSchema)
    .safeParse(Array.isArray(periods.monthly) ? periods.monthly : []);
  const daily = z
    .array(periodSchema)
    .safeParse(Array.isArray(periods.daily) ? periods.daily : []);
  return {
    id: value.id,
    controlMode: value.controlMode,
    status: value.status,
    annualCostCzk: number(value.annualCostCzk),
    annualImportCostCzk: number(value.annualImportCostCzk),
    annualExportRevenueCzk: number(value.annualExportRevenueCzk),
    annualFixedCostCzk: number(value.annualFixedCostCzk),
    periods: {
      monthly: monthly.success ? monthly.data : [],
      daily: daily.success ? daily.data : [],
    },
  };
}

export async function getAnalysisScenarioDetail(
  userId: number,
  scenarioId: string,
) {
  const scenario = await prisma.energyAnalysisScenario.findFirst({
    where: { id: scenarioId, analysisRun: { userId } },
    include: {
      analysisRun: {
        include: {
          energySite: { include: { technicalProfile: true } },
        },
      },
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
  });
  if (!scenario) throw new Error("ANALYSIS_SCENARIO_NOT_FOUND");
  const pairPrefix = scenario.scenarioKey.replace(/:(SELF_USE|SMART)$/, "");
  const pairedScenarios = await prisma.energyAnalysisScenario.findMany({
    where: {
      analysisRunId: scenario.analysisRunId,
      scenarioKey: {
        in: [`${pairPrefix}:SELF_USE`, `${pairPrefix}:SMART`],
      },
    },
    select: {
      id: true,
      controlMode: true,
      status: true,
      annualCostCzk: true,
      annualImportCostCzk: true,
      annualExportRevenueCzk: true,
      annualFixedCostCzk: true,
      result: true,
    },
  });
  const comparison = pairedScenarios.map(scenarioEvidence);
  const selectedEvidence =
    comparison.find((item) => item.id === scenario.id) ??
    scenarioEvidence(scenario);
  const buy = scenario.priceCurve.buyProductVersion;
  const sell = scenario.priceCurve.sellProductVersion;
  const distribution = scenario.priceCurve.distributionVersion;
  const profile = scenario.analysisRun.energySite.technicalProfile;
  const buyMetadata = object(buy?.product.metadata);
  const sellMetadata = object(sell?.product.metadata);
  const breakerFee =
    distribution && profile?.phases && scenario.mainFuseA
      ? breakerMonthlyFee(
          distribution.breakerFees,
          profile.phases,
          scenario.mainFuseA,
        )
      : null;
  return {
    id: scenario.id,
    controlMode: scenario.controlMode,
    status: scenario.status,
    dataFrom: scenario.analysisRun.dataFrom?.toISOString() ?? null,
    dataTo: scenario.analysisRun.dataTo?.toISOString() ?? null,
    annualCostCzk: number(scenario.annualCostCzk),
    annualImportCostCzk: number(scenario.annualImportCostCzk),
    annualExportRevenueCzk: number(scenario.annualExportRevenueCzk),
    annualFixedCostCzk: number(scenario.annualFixedCostCzk),
    periods: selectedEvidence.periods,
    comparison: {
      selfUse:
        comparison.find((item) => item.controlMode === "SELF_USE") ?? null,
      smart: comparison.find((item) => item.controlMode === "SMART") ?? null,
    },
    buy: buy
      ? {
          supplier: buy.product.supplier.name,
          product: buy.product.name,
          mode: buy.buyMode,
          fixedVtCzkKwh: number(buy.fixedBuyVtCzkKwh),
          fixedNtCzkKwh: number(buy.fixedBuyNtCzkKwh),
          spotFeeCzkKwh: number(buy.spotBuyFeeCzkKwh),
          monthlyFeeCzk: number(buy.monthlyFeeCzk),
          availabilityNote:
            typeof buyMetadata.availabilityNote === "string"
              ? buyMetadata.availabilityNote
              : null,
          sourceUrl:
            typeof buyMetadata.sourceUrl === "string"
              ? buyMetadata.sourceUrl
              : null,
        }
      : null,
    sell: sell
      ? {
          supplier: sell.product.supplier.name,
          product: sell.product.name,
          mode: sell.sellMode,
          fixedVtCzkKwh: number(sell.fixedSellVtCzkKwh),
          fixedNtCzkKwh: number(sell.fixedSellNtCzkKwh),
          spotFeeCzkKwh: number(sell.spotSellFeeCzkKwh),
          monthlyFeeCzk:
            buy?.id === sell.id ? 0 : number(sell.monthlyFeeCzk),
          availabilityNote:
            typeof sellMetadata.availabilityNote === "string"
              ? sellMetadata.availabilityNote
              : null,
          sourceUrl:
            typeof sellMetadata.sourceUrl === "string"
              ? sellMetadata.sourceUrl
              : null,
        }
      : null,
    distribution: distribution
      ? {
          code: distribution.distributionTariff.code,
          eligibilityNote:
            distribution.distributionTariff.eligibilityNote,
          vtCzkKwh: number(distribution.distributionVtCzkKwh),
          ntCzkKwh: number(distribution.distributionNtCzkKwh),
          systemServicesCzkKwh: number(
            distribution.systemServicesCzkKwh,
          ),
          electricityTaxCzkKwh: number(
            distribution.electricityTaxCzkKwh,
          ),
          pozeCzkKwh: number(distribution.pozeCzkKwh),
          monthlyMeterFeeCzk: number(distribution.monthlyMeterFeeCzk),
          monthlyBreakerFeeCzk: breakerFee,
        }
      : null,
    monthlyFixedTotalCzk: number(scenario.priceCurve.monthlyFixedCzk),
  };
}
