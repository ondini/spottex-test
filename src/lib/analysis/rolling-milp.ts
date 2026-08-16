import {
  createDispatchPeriodAccumulator,
  simulateSelfUse,
  type AnalysisBattery,
  type AnalysisDispatchPoint,
  type AnalysisDispatchResult,
  type AnalysisGrid,
} from "./dispatch";
import { createForecastRuntime, selectForecastPolicy, type ForecastSelection } from "./forecast";
import { optimizeMilpHorizon } from "./milp";

// V9 plans in quarter hours rather than hours. The version is stamped onto every
// run, so it has to move whenever the numbers do -- otherwise results produced
// under the two resolutions are indistinguishable after the fact.
export const ROLLING_MILP_METHOD_VERSION = "ROLLING_4H_REPLAN_15M_PLAN_15M_DISPATCH_VALIDATED_FORECAST_V9";

function round(value: number, digits = 6) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

type Applied = {
  importKwh: number;
  exportKwh: number;
  chargeKwh: number;
  dischargeKwh: number;
  curtailedKwh: number;
  unservedKwh: number;
  endingSocKwh: number;
};

type PlanningPoint = {
  point: AnalysisDispatchPoint;
  sourceIntervals: number;
};

export function guardSmartResult<T extends AnalysisDispatchResult>(
  smartResult: T,
  selfUseResult: AnalysisDispatchResult,
): T {
  if (smartResult.variableCostCzk <= selfUseResult.variableCostCzk)
    return smartResult;
  const smartCandidateVariableCostCzk = smartResult.variableCostCzk;
  return {
    ...smartResult,
    ...selfUseResult,
    strategy: "SMART_SELF_USE_FALLBACK",
    smartCandidateVariableCostCzk,
  } as T;
}

function aggregatePlanningHorizon(points: AnalysisDispatchPoint[], intervalsPerBucket: number): PlanningPoint[] {
  if (intervalsPerBucket <= 1) return points.map((point) => ({ point, sourceIntervals: 1 }));
  const result: PlanningPoint[] = [];
  let index = 0;
  while (index < points.length) {
    const bucket = [points[index]];
    while (
      bucket.length < intervalsPerBucket &&
      index + bucket.length < points.length
    ) {
      const previous = bucket[bucket.length - 1];
      const next = points[index + bucket.length];
      if (next.startAt.getTime() !== previous.endAt.getTime()) break;
      bucket.push(next);
    }
    const sourceIntervals = bucket.length;
    result.push({
      sourceIntervals,
      point: {
        startAt: bucket[0].startAt,
        endAt: bucket[sourceIntervals - 1].endAt,
        productionKwh: bucket.reduce((sum, point) => sum + point.productionKwh, 0),
        consumptionKwh: bucket.reduce((sum, point) => sum + point.consumptionKwh, 0),
        totalBuyCzkKwh: bucket.reduce((sum, point) => sum + point.totalBuyCzkKwh, 0) / sourceIntervals,
        totalSellCzkKwh: bucket.reduce((sum, point) => sum + point.totalSellCzkKwh, 0) / sourceIntervals,
      },
    });
    index += sourceIntervals;
  }
  return result;
}

function simulateWithoutUsableBattery(
  points: AnalysisDispatchPoint[],
  battery: AnalysisBattery,
  grid: AnalysisGrid,
  timezone: string,
): AnalysisDispatchResult {
  let importKwh = 0; let exportKwh = 0; let curtailedKwh = 0; let unservedKwh = 0;
  let importCostCzk = 0; let exportRevenueCzk = 0; let peakImportKw = 0;
  const periods = createDispatchPeriodAccumulator(timezone);
  for (const point of points) {
    const hours = (point.endAt.getTime() - point.startAt.getTime()) / 3_600_000;
    const deficit = Math.max(0, point.consumptionKwh - point.productionKwh);
    const surplus = Math.max(0, point.productionKwh - point.consumptionKwh);
    const importLimit = grid.maxImportKw == null ? Number.POSITIVE_INFINITY : grid.maxImportKw * hours;
    const imported = Math.min(deficit, importLimit);
    const exportLimit = !grid.exportAllowed || point.totalSellCzkKwh < 0
      ? 0
      : grid.maxExportKw == null ? Number.POSITIVE_INFINITY : grid.maxExportKw * hours;
    const exported = Math.min(surplus, exportLimit);
    importKwh += imported;
    exportKwh += exported;
    curtailedKwh += surplus - exported;
    unservedKwh += deficit - imported;
    importCostCzk += imported * point.totalBuyCzkKwh;
    exportRevenueCzk += exported * point.totalSellCzkKwh;
    peakImportKw = Math.max(peakImportKw, imported / hours);
    periods.add(point.startAt, {
      importKwh: imported,
      exportKwh: exported,
      chargedKwh: 0,
      dischargedKwh: 0,
      importCostCzk: imported * point.totalBuyCzkKwh,
      exportRevenueCzk: exported * point.totalSellCzkKwh,
    });
  }
  return {
    importKwh: round(importKwh), exportKwh: round(exportKwh), chargedKwh: 0, dischargedKwh: 0,
    curtailedKwh: round(curtailedKwh), unservedKwh: round(unservedKwh),
    variableCostCzk: round(importCostCzk - exportRevenueCzk, 2), importCostCzk: round(importCostCzk, 2),
    exportRevenueCzk: round(exportRevenueCzk, 2), peakImportKw: round(peakImportKw, 3), batteryCycles: 0,
    endingSocKwh: round(battery.capacityKwh * battery.minSocPct / 100), strategy: "SMART_MILP",
    periods: periods.result(),
  };
}

function applyFirstAction(input: {
  actual: AnalysisDispatchPoint;
  predicted: AnalysisDispatchPoint;
  planned: Awaited<ReturnType<typeof optimizeMilpHorizon>>["points"][number];
  battery: AnalysisBattery;
  grid: AnalysisGrid;
  socKwh: number;
}): Applied {
  const { actual, predicted, planned, battery, grid } = input;
  const hours = (actual.endAt.getTime() - actual.startAt.getTime()) / 3_600_000;
  const eta = Math.sqrt(battery.roundtripEfficiencyPct / 100);
  const minSoc = battery.capacityKwh * battery.minSocPct / 100;
  const maxSoc = battery.capacityKwh * battery.maxSocPct / 100;
  const chargeLimit = Math.min(battery.maxChargeKw * hours, (maxSoc - input.socKwh) / eta);
  const dischargeLimit = Math.min(battery.maxDischargeKw * hours, (input.socKwh - minSoc) * eta);
  const actualSurplus = Math.max(0, actual.productionKwh - actual.consumptionKwh);
  const actualDeficit = Math.max(0, actual.consumptionKwh - actual.productionKwh);
  const predictedSurplus = Math.max(0, predicted.productionKwh - predicted.consumptionKwh);
  const exportIntent = planned.dischargeKwh > 0 && planned.exportKwh > predictedSurplus + 1e-6;
  const gridChargeIntent = planned.chargeKwh > 0 && predictedSurplus <= 1e-6;
  let charge = 0;
  let discharge = 0;
  if (planned.chargeKwh > 1e-6) charge = gridChargeIntent ? Math.min(planned.chargeKwh, chargeLimit) : Math.min(actualSurplus, chargeLimit);
  else if (planned.dischargeKwh > 1e-6) discharge = exportIntent ? Math.min(planned.dischargeKwh, dischargeLimit) : Math.min(actualDeficit, dischargeLimit);
  else if (actualSurplus > 0) charge = Math.min(actualSurplus, chargeLimit);
  else discharge = Math.min(actualDeficit, dischargeLimit);

  let netGrid = actual.consumptionKwh + charge - actual.productionKwh - discharge;
  const importLimit = grid.maxImportKw == null ? Number.POSITIVE_INFINITY : grid.maxImportKw * hours;
  if (netGrid > importLimit) {
    const reduceCharge = Math.min(charge, netGrid - importLimit);
    charge -= reduceCharge;
    netGrid -= reduceCharge;
    const extraDischarge = Math.min(dischargeLimit - discharge, netGrid - importLimit);
    discharge += extraDischarge;
    netGrid -= extraDischarge;
  }
  const exportLimit = !grid.exportAllowed ? 0 : grid.maxExportKw == null ? Number.POSITIVE_INFINITY : grid.maxExportKw * hours;
  if (netGrid < -exportLimit && exportIntent && discharge > 0) {
    const reduceDischarge = Math.min(discharge, -exportLimit - netGrid);
    discharge -= reduceDischarge;
    netGrid += reduceDischarge;
  }
  const imported = Math.min(Math.max(0, netGrid), importLimit);
  const unserved = Math.max(0, netGrid - imported);
  // A negative/very low sell price can make deliberate curtailment optimal.
  // Respect that first-step plan instead of exporting an actual surplus merely
  // because the physical grid limit would permit it.
  const plannedCurtailment = planned.curtailedKwh > 1e-6;
  const effectiveExportLimit = plannedCurtailment ? Math.min(exportLimit, planned.exportKwh) : exportLimit;
  const exported = Math.min(Math.max(0, -netGrid), effectiveExportLimit);
  const curtailed = Math.max(0, -netGrid - exported);
  const endingSoc = Math.max(minSoc, Math.min(maxSoc, input.socKwh + charge * eta - discharge / eta));
  return { importKwh: imported, exportKwh: exported, chargeKwh: charge, dischargeKwh: discharge, curtailedKwh: curtailed, unservedKwh: unserved, endingSocKwh: endingSoc };
}

export async function simulateRollingMilp(input: {
  points: AnalysisDispatchPoint[];
  battery: AnalysisBattery;
  grid: AnalysisGrid;
  timezone?: string;
  horizonHours?: number;
  cycleCostCzkKwh?: number;
  maxSteps?: number;
  planningResolutionMinutes?: 15 | 60;
  replanHours?: number;
  maxSolverCalls?: number;
  warmupIntervals?: number;
  signal?: AbortSignal;
  forecastSelection?: ForecastSelection;
}): Promise<AnalysisDispatchResult & { solverCalls: number; solverFallbacks: number; forecastMethod: string; forecastQuality: ForecastSelection; warmupIntervals: number; planningResolutionMinutes: number; replanHours: number }> {
  const timezone = input.timezone ?? "Europe/Prague";
  const intervalMinutes = input.points.length
    ? (input.points[0].endAt.getTime() - input.points[0].startAt.getTime()) / 60_000
    : 15;
  const horizonIntervals = Math.max(1, Math.round((input.horizonHours ?? 34) * 60 / intervalMinutes));
  const planningIntervalsPerBucket = Math.max(1, Math.round((input.planningResolutionMinutes ?? 60) / intervalMinutes));
  const warmupIntervals = Math.max(0, Math.min(input.warmupIntervals ?? 0, input.points.length - 1));
  const forecastQuality = input.forecastSelection ?? selectForecastPolicy(input.points, timezone);
  const forecaster = createForecastRuntime(forecastQuality, timezone);
  const minSoc = input.battery.capacityKwh * input.battery.minSocPct / 100;
  let soc = minSoc;
  let importKwh = 0; let exportKwh = 0; let chargedKwh = 0; let dischargedKwh = 0;
  let curtailedKwh = 0; let unservedKwh = 0; let importCostCzk = 0; let exportRevenueCzk = 0; let peakImportKw = 0;
  let solverCalls = 0; let solverFallbacks = 0;
  const periods = createDispatchPeriodAccumulator(timezone);
  const requestedExecutionBucketsPerPlan = Math.max(
    1,
    Math.round(
      (input.replanHours ?? 4) * 60 /
        (input.planningResolutionMinutes ?? 60),
    ),
  );
  const cachedPlanBuckets: Array<{
    remainingIntervals: number;
    predictedPerInterval: AnalysisDispatchPoint;
    plannedPerInterval: Awaited<ReturnType<typeof optimizeMilpHorizon>>["points"][number];
  }> = [];
  const limit = Math.min(input.points.length, input.maxSteps ?? input.points.length);
  const evaluatedIntervals = Math.max(0, limit - warmupIntervals);
  const minimumExecutionBucketsForBudget = input.maxSolverCalls
    ? Math.ceil(
        evaluatedIntervals /
          (Math.max(1, input.maxSolverCalls) * planningIntervalsPerBucket),
      )
    : 1;
  const executionBucketsPerPlan = Math.max(
    requestedExecutionBucketsPerPlan,
    minimumExecutionBucketsForBudget,
  );
  const effectiveReplanHours =
    (executionBucketsPerPlan * (input.planningResolutionMinutes ?? 60)) / 60;
  if (input.battery.capacityKwh <= 0 || input.battery.maxChargeKw <= 0 || input.battery.maxDischargeKw <= 0) {
    const result = simulateWithoutUsableBattery(
      input.points.slice(warmupIntervals, limit),
      input.battery,
      input.grid,
      timezone,
    );
    return {
      ...result,
      solverCalls: 0,
      solverFallbacks: 0,
      forecastMethod: `${ROLLING_MILP_METHOD_VERSION}:${forecastQuality.consumption.selected}:${forecastQuality.production.selected}`,
      forecastQuality,
      warmupIntervals,
      planningResolutionMinutes: input.planningResolutionMinutes ?? 60,
      replanHours: effectiveReplanHours,
    };
  }
  for (let index = 0; index < limit; index += 1) {
    if (index % 96 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    if (input.signal?.aborted) throw new Error("ANALYSIS_ROLLING_ABORTED");
    if (index > 0) forecaster.observe(input.points[index - 1]);
    if (index < warmupIntervals) continue;
    const actual = input.points[index];
    let applied: Applied;
    try {
      if (!cachedPlanBuckets.length) {
        const horizonActualPrices = input.points.slice(index, Math.min(input.points.length, index + horizonIntervals));
        const predicted = horizonActualPrices.map(forecaster.forecast);
        const planningHorizon = aggregatePlanningHorizon(predicted, planningIntervalsPerBucket);
        const plan = await optimizeMilpHorizon({ points: planningHorizon.map(({ point }) => point), battery: input.battery, grid: input.grid, initialSocKwh: soc, cycleCostCzkKwh: input.cycleCostCzkKwh, timeLimitSeconds: 5 });
        solverCalls += 1;
        let predictedOffset = 0;
        for (
          let bucketIndex = 0;
          bucketIndex <
          Math.min(executionBucketsPerPlan, planningHorizon.length);
          bucketIndex += 1
        ) {
          const bucket = planningHorizon[bucketIndex];
          const bucketSize = bucket.sourceIntervals;
          const planned = plan.points[bucketIndex];
          cachedPlanBuckets.push({
            remainingIntervals: bucketSize,
            predictedPerInterval: {
              ...predicted[predictedOffset],
              productionKwh: bucket.point.productionKwh / bucketSize,
              consumptionKwh: bucket.point.consumptionKwh / bucketSize,
            },
            plannedPerInterval: {
              ...planned,
              importKwh: planned.importKwh / bucketSize,
              exportKwh: planned.exportKwh / bucketSize,
              chargeKwh: planned.chargeKwh / bucketSize,
              dischargeKwh: planned.dischargeKwh / bucketSize,
              curtailedKwh: planned.curtailedKwh / bucketSize,
              unservedKwh: planned.unservedKwh / bucketSize,
            },
          });
          predictedOffset += bucketSize;
          // Do not carry an action plan across a gap in measured data.
          if (bucketSize < planningIntervalsPerBucket) break;
        }
      }
      const currentPlanBucket = cachedPlanBuckets[0];
      applied = applyFirstAction({
        actual,
        predicted: currentPlanBucket.predictedPerInterval,
        planned: {
          ...currentPlanBucket.plannedPerInterval,
          startAt: actual.startAt,
          endAt: actual.endAt,
        },
        battery: input.battery,
        grid: input.grid,
        socKwh: soc,
      });
      currentPlanBucket.remainingIntervals -= 1;
      if (currentPlanBucket.remainingIntervals <= 0) cachedPlanBuckets.shift();
    } catch {
      solverFallbacks += 1;
      cachedPlanBuckets.length = 0;
      const fallbackPlan = { startAt: actual.startAt, endAt: actual.endAt, importKwh: 0, exportKwh: 0, chargeKwh: 0, dischargeKwh: 0, curtailedKwh: 0, unservedKwh: 0, endingSocKwh: soc };
      applied = applyFirstAction({ actual, predicted: actual, planned: fallbackPlan, battery: input.battery, grid: input.grid, socKwh: soc });
    }
    const hours = (actual.endAt.getTime() - actual.startAt.getTime()) / 3_600_000;
    soc = applied.endingSocKwh;
    importKwh += applied.importKwh; exportKwh += applied.exportKwh; chargedKwh += applied.chargeKwh; dischargedKwh += applied.dischargeKwh;
    curtailedKwh += applied.curtailedKwh; unservedKwh += applied.unservedKwh;
    importCostCzk += applied.importKwh * actual.totalBuyCzkKwh;
    exportRevenueCzk += applied.exportKwh * actual.totalSellCzkKwh;
    peakImportKw = Math.max(peakImportKw, applied.importKwh / hours);
    periods.add(actual.startAt, {
      importKwh: applied.importKwh,
      exportKwh: applied.exportKwh,
      chargedKwh: applied.chargeKwh,
      dischargedKwh: applied.dischargeKwh,
      importCostCzk: applied.importKwh * actual.totalBuyCzkKwh,
      exportRevenueCzk: applied.exportKwh * actual.totalSellCzkKwh,
    });
  }
  const smartResult = {
    importKwh: round(importKwh), exportKwh: round(exportKwh), chargedKwh: round(chargedKwh), dischargedKwh: round(dischargedKwh),
    curtailedKwh: round(curtailedKwh), unservedKwh: round(unservedKwh), variableCostCzk: round(importCostCzk - exportRevenueCzk, 2),
    importCostCzk: round(importCostCzk, 2), exportRevenueCzk: round(exportRevenueCzk, 2), peakImportKw: round(peakImportKw, 3),
    batteryCycles: input.battery.capacityKwh > 0 ? round(dischargedKwh / input.battery.capacityKwh, 3) : 0,
    endingSocKwh: round(soc), strategy: "SMART_MILP" as const, solverCalls, solverFallbacks,
    forecastMethod: `${ROLLING_MILP_METHOD_VERSION}:${forecastQuality.consumption.selected}:${forecastQuality.production.selected}`,
    forecastQuality, warmupIntervals, planningResolutionMinutes: input.planningResolutionMinutes ?? 60,
    replanHours: effectiveReplanHours,
    periods: periods.result(),
  };
  const selfUseResult = simulateSelfUse(
    input.points.slice(warmupIntervals, limit),
    input.battery,
    input.grid,
    timezone,
  );
  return guardSmartResult(smartResult, selfUseResult);
}
