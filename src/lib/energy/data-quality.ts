import "server-only";

import { EnergyIntervalKind, EnergyProvider } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { aggregateSiteIntervals } from "@/lib/analysis/load-profile";

import { EnergyError } from "./types";

const dayPluralRules = new Intl.PluralRules("cs-CZ");

function completeDaysLabel(value: number) {
  const suffix = dayPluralRules.select(value) === "one"
    ? "úplný den"
    : dayPluralRules.select(value) === "few"
      ? "úplné dny"
      : "úplných dní";
  return `${value.toLocaleString("cs-CZ")} ${suffix}`;
}

export type EnergyDataQuality = {
  from: string | null;
  to: string | null;
  matchedIntervals: number;
  expectedIntervals: number;
  missingIntervals: number;
  duplicateIntervals: number;
  overlappingIntervals: number;
  invalidDurationIntervals: number;
  balanceEvaluatedIntervals: number;
  balanceInvalidIntervals: number;
  balanceMeanAbsoluteErrorKwh: number | null;
  measuredConsumptionKwh: number;
  measuredProductionKwh: number;
  annualizedConsumptionKwh: number;
  annualizedProductionKwh: number;
  gridMeasuredDays: number;
  measuredGridImportKwh: number;
  measuredGridExportKwh: number;
  coverageWindows: Array<{ days: 30 | 90 | 365; matchedIntervals: number; expectedIntervals: number; coveragePercent: number }>;
  coverageDays: number;
  spanDays: number;
  coveragePercent: number;
  confidence: "NONE" | "LOW" | "MEDIUM" | "HIGH";
  readyForEstimate: boolean;
  minimumDays: number;
  message: string;
};

export function summarizeEnergyDataQuality(input: {
  production: Array<{ startAt: Date; endAt: Date; kwh?: number }>;
  consumption: Array<{ startAt: Date; endAt: Date; kwh?: number }>;
  battery?: Array<{ startAt: Date; endAt: Date; kwh?: number }>;
  gridImport?: Array<{ startAt: Date; endAt: Date; kwh?: number }>;
  gridExport?: Array<{ startAt: Date; endAt: Date; kwh?: number }>;
  minimumDays?: number;
}): EnergyDataQuality {
  const minimumDays = input.minimumDays ?? 7;
  const duplicateIntervals = (items: Array<{ startAt: Date }>) => items.length - new Set(items.map((item) => item.startAt.getTime())).size;
  const overlappingIntervals = (items: Array<{ startAt: Date; endAt: Date }>) => {
    const sorted = [...items].sort((left, right) => left.startAt.getTime() - right.startAt.getTime() || left.endAt.getTime() - right.endAt.getTime());
    let overlaps = 0;
    let furthestEnd = Number.NEGATIVE_INFINITY;
    for (const item of sorted) {
      const start = item.startAt.getTime();
      const end = item.endAt.getTime();
      if (start < furthestEnd) overlaps += 1;
      furthestEnd = Math.max(furthestEnd, end);
    }
    return overlaps;
  };
  const duplicates = duplicateIntervals(input.production) + duplicateIntervals(input.consumption);
  const overlaps = overlappingIntervals(input.production) + overlappingIntervals(input.consumption);
  const production = new Map(input.production.map((item) => [item.startAt.getTime(), item]));
  const consumption = new Map(input.consumption.map((item) => [item.startAt.getTime(), item]));
  const matched = [...production.keys()]
    .filter((timestamp) => {
      const produced = production.get(timestamp)?.kwh;
      const consumed = consumption.get(timestamp)?.kwh;
      return (
        typeof produced === "number" &&
        Number.isFinite(produced) &&
        produced >= 0 &&
        typeof consumed === "number" &&
        Number.isFinite(consumed) &&
        consumed >= 0
      );
    })
    .sort((a, b) => a - b);
  if (!matched.length) {
    return {
      from: null,
      to: null,
      matchedIntervals: 0,
      expectedIntervals: 0,
      missingIntervals: 0,
      duplicateIntervals: duplicates,
      overlappingIntervals: overlaps,
      invalidDurationIntervals: 0,
      balanceEvaluatedIntervals: 0,
      balanceInvalidIntervals: 0,
      balanceMeanAbsoluteErrorKwh: null,
      measuredConsumptionKwh: 0,
      measuredProductionKwh: 0,
      annualizedConsumptionKwh: 0,
      annualizedProductionKwh: 0,
      gridMeasuredDays: 0,
      measuredGridImportKwh: 0,
      measuredGridExportKwh: 0,
      coverageWindows: ([30, 90, 365] as const).map((days) => ({ days, matchedIntervals: 0, expectedIntervals: days * 96, coveragePercent: 0 })),
      coverageDays: 0,
      spanDays: 0,
      coveragePercent: 0,
      confidence: "NONE",
      readyForEstimate: false,
      minimumDays,
      message: "Nemáme žádné společné naměřené intervaly výroby a spotřeby.",
    };
  }
  const first = matched[0];
  const last = matched.at(-1) ?? first;
  const expectedIntervals = Math.floor((last - first) / 900_000) + 1;
  const coverageDays = matched.length / 96;
  const spanDays = ((last - first) / 86_400_000) + 1 / 96;
  const coveragePercent = expectedIntervals > 0 ? matched.length / expectedIntervals * 100 : 0;
  let invalidDurationIntervals = 0;
  for (const timestamp of matched) {
    const productionItem = production.get(timestamp);
    const consumptionItem = consumption.get(timestamp);
    if (!productionItem || !consumptionItem) continue;
    const productionMinutes = (productionItem.endAt.getTime() - timestamp) / 60_000;
    const consumptionMinutes = (consumptionItem.endAt.getTime() - timestamp) / 60_000;
    if (productionMinutes !== 15 || consumptionMinutes !== 15) invalidDurationIntervals += 1;
  }
  const battery = new Map((input.battery ?? []).map((item) => [item.startAt.getTime(), item]));
  const gridImport = new Map((input.gridImport ?? []).map((item) => [item.startAt.getTime(), item]));
  const gridExport = new Map((input.gridExport ?? []).map((item) => [item.startAt.getTime(), item]));
  const measuredConsumptionKwh = matched.reduce(
    (sum, timestamp) => sum + (consumption.get(timestamp)?.kwh ?? 0),
    0,
  );
  const measuredProductionKwh = matched.reduce(
    (sum, timestamp) => sum + (production.get(timestamp)?.kwh ?? 0),
    0,
  );
  const gridMeasuredIntervals = matched.filter(
    (timestamp) => gridImport.has(timestamp) && gridExport.has(timestamp),
  );
  const measuredGridImportKwh = gridMeasuredIntervals.reduce(
    (sum, timestamp) => sum + (gridImport.get(timestamp)?.kwh ?? 0),
    0,
  );
  const measuredGridExportKwh = gridMeasuredIntervals.reduce(
    (sum, timestamp) => sum + (gridExport.get(timestamp)?.kwh ?? 0),
    0,
  );
  let balanceEvaluatedIntervals = 0;
  let balanceInvalidIntervals = 0;
  let balanceAbsoluteError = 0;
  for (const timestamp of matched) {
    const productionKwh = production.get(timestamp)?.kwh;
    const consumptionKwh = consumption.get(timestamp)?.kwh;
    const batteryKwh = battery.get(timestamp)?.kwh;
    const importKwh = gridImport.get(timestamp)?.kwh;
    const exportKwh = gridExport.get(timestamp)?.kwh;
    if (![productionKwh, consumptionKwh, batteryKwh, importKwh, exportKwh].every((value) => typeof value === "number" && Number.isFinite(value))) continue;
    // Canonical interval contract: battery > 0 is discharge, battery < 0 is charge.
    const supply = productionKwh! + importKwh! + Math.max(0, batteryKwh!);
    const demand = consumptionKwh! + exportKwh! + Math.max(0, -batteryKwh!);
    const error = Math.abs(supply - demand);
    const tolerance = Math.max(0.05, Math.max(supply, demand) * 0.05);
    balanceEvaluatedIntervals += 1;
    balanceAbsoluteError += error;
    if (error > tolerance) balanceInvalidIntervals += 1;
  }
  const balanceFailureRate = balanceEvaluatedIntervals > 0 ? balanceInvalidIntervals / balanceEvaluatedIntervals : 0;
  const balanceCanBlock = balanceEvaluatedIntervals >= 7 * 96;
  const coverageWindows = ([30, 90, 365] as const).map((days) => {
    const windowStart = last - (days * 96 - 1) * 900_000;
    const count = matched.filter((timestamp) => timestamp >= windowStart && timestamp <= last).length;
    const expected = days * 96;
    return { days, matchedIntervals: count, expectedIntervals: expected, coveragePercent: Math.round(count / expected * 1_000) / 10 };
  });
  const confidence = coverageDays >= 300 && coveragePercent >= 95
    ? "HIGH"
    : coverageDays >= 30 && coveragePercent >= 80
      ? "MEDIUM"
      : "LOW";
  const readyForEstimate = coverageDays >= minimumDays && coveragePercent >= 75 && invalidDurationIntervals === 0 && duplicates === 0 && overlaps === 0 && (!balanceCanBlock || balanceFailureRate <= 0.05);
  const roundedDays = Math.round(coverageDays * 10) / 10;
  return {
    from: new Date(first).toISOString(),
    to: new Date(last).toISOString(),
    matchedIntervals: matched.length,
    expectedIntervals,
    missingIntervals: Math.max(0, expectedIntervals - matched.length),
    duplicateIntervals: duplicates,
    overlappingIntervals: overlaps,
    invalidDurationIntervals,
    balanceEvaluatedIntervals,
    balanceInvalidIntervals,
    balanceMeanAbsoluteErrorKwh: balanceEvaluatedIntervals > 0 ? Math.round(balanceAbsoluteError / balanceEvaluatedIntervals * 10_000) / 10_000 : null,
    measuredConsumptionKwh: Math.round(measuredConsumptionKwh * 10) / 10,
    measuredProductionKwh: Math.round(measuredProductionKwh * 10) / 10,
    annualizedConsumptionKwh:
      Math.round((measuredConsumptionKwh / coverageDays) * 3650) / 10,
    annualizedProductionKwh:
      Math.round((measuredProductionKwh / coverageDays) * 3650) / 10,
    gridMeasuredDays: Math.round((gridMeasuredIntervals.length / 96) * 10) / 10,
    measuredGridImportKwh: Math.round(measuredGridImportKwh * 10) / 10,
    measuredGridExportKwh: Math.round(measuredGridExportKwh * 10) / 10,
    coverageWindows,
    coverageDays: roundedDays,
    spanDays: Math.round(spanDays * 10) / 10,
    coveragePercent: Math.round(coveragePercent * 10) / 10,
    confidence,
    readyForEstimate,
    minimumDays,
    message: readyForEstimate
      ? confidence === "HIGH"
        ? "Historie je dostatečná pro sezónní srovnání."
        : `Máme ${completeDaysLabel(roundedDays)} dat. Výsledek bude označený jako orientační.`
      : balanceCanBlock && balanceFailureRate > 0.05
        ? `Energetická bilance nesedí u ${Math.round(balanceFailureRate * 100)} % úplných intervalů. Před analýzou je nutná kontrola znamének a jednotek.`
        : coverageDays >= minimumDays && coveragePercent < 75
          ? `Máme ${completeDaysLabel(roundedDays)} měření, ale v časovém rozsahu historie pokrývají jen ${Math.round(coveragePercent * 10) / 10} %. Pro bezpečný odhad je potřeba alespoň 75 %; SolaX cloud v chybějících obdobích nevrátil data.`
        : `Pro první odhad potřebujeme alespoň ${minimumDays} úplných dní v 15minutových intervalech.`,
  };
}

const qualityCache = new Map<
  string,
  { expiresAt: number; value: Promise<EnergyDataQuality> }
>();
const QUALITY_CACHE_MS = Math.max(
  5_000,
  Number(process.env.ENERGY_DATA_QUALITY_CACHE_MS ?? 30_000),
);

export function invalidateEnergyDataQualityCache(siteId: number) {
  for (const key of qualityCache.keys()) {
    if (key.endsWith(`:${siteId}`)) qualityCache.delete(key);
  }
}

async function computeEnergyDataQuality(
  userId: number,
  siteId: number,
): Promise<EnergyDataQuality> {
  const site = await prisma.energySite.findFirst({
    where: { id: siteId, userId },
    include: { inverters: { orderBy: { id: "asc" } } },
  });
  if (!site) throw new EnergyError("SITE_NOT_FOUND", "Elektrárna nebyla nalezena.", 404);
  if (!site.inverters.length) throw new EnergyError("INVERTER_NOT_FOUND", "Elektrárna zatím nemá připojený střídač.", 404);
  const rawIntervals = await prisma.energyInterval.findMany({
    where: {
      inverterId: { in: site.inverters.map((inverter) => inverter.id) },
      predicted: false,
      kind: { in: [EnergyIntervalKind.PRODUCTION, EnergyIntervalKind.CONSUMPTION, EnergyIntervalKind.BATTERY, EnergyIntervalKind.GRID_IMPORT, EnergyIntervalKind.GRID_EXPORT] },
      startAt: { gte: new Date(Date.now() - 366 * 86_400_000), lte: new Date() },
    },
    select: { inverterId: true, kind: true, startAt: true, endAt: true, kwh: true },
    orderBy: { startAt: "asc" },
  });
  const expectedInverterIds = new Set(
    site.inverters.map((inverter) => inverter.id),
  );
  const requiredCoverage = new Map<
    number,
    Map<number, Set<EnergyIntervalKind>>
  >();
  for (const interval of rawIntervals) {
    if (
      interval.kind !== EnergyIntervalKind.PRODUCTION &&
      interval.kind !== EnergyIntervalKind.CONSUMPTION
    ) {
      continue;
    }
    const timestamp = interval.startAt.getTime();
    const byInverter = requiredCoverage.get(timestamp) ?? new Map();
    const kinds = byInverter.get(interval.inverterId) ?? new Set();
    kinds.add(interval.kind);
    byInverter.set(interval.inverterId, kinds);
    requiredCoverage.set(timestamp, byInverter);
  }
  const completeSiteTimestamps = new Set(
    [...requiredCoverage.entries()]
      .filter(([, byInverter]) =>
        [...expectedInverterIds].every((inverterId) => {
          const kinds = byInverter.get(inverterId);
          return (
            kinds?.has(EnergyIntervalKind.PRODUCTION) &&
            kinds.has(EnergyIntervalKind.CONSUMPTION)
          );
        }),
      )
      .map(([timestamp]) => timestamp),
  );
  const intervals = aggregateSiteIntervals(
    rawIntervals.filter((interval) =>
      completeSiteTimestamps.has(interval.startAt.getTime()),
    ),
  );
  return summarizeEnergyDataQuality({
    production: intervals.filter((item) => item.kind === EnergyIntervalKind.PRODUCTION),
    consumption: intervals.filter((item) => item.kind === EnergyIntervalKind.CONSUMPTION),
    battery: intervals.filter((item) => item.kind === EnergyIntervalKind.BATTERY),
    gridImport: intervals.filter((item) => item.kind === EnergyIntervalKind.GRID_IMPORT),
    gridExport: intervals.filter((item) => item.kind === EnergyIntervalKind.GRID_EXPORT),
    minimumDays: site.provider === EnergyProvider.DEMO ? 0.25 : 7,
  });
}

export async function getEnergyDataQuality(
  userId: number,
  siteId: number,
): Promise<EnergyDataQuality> {
  const key = `${userId}:${siteId}`;
  const cached = qualityCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = computeEnergyDataQuality(userId, siteId);
  qualityCache.set(key, {
    expiresAt: Date.now() + QUALITY_CACHE_MS,
    value,
  });
  try {
    return await value;
  } catch (error) {
    if (qualityCache.get(key)?.value === value) qualityCache.delete(key);
    throw error;
  }
}
