export type AnalysisDispatchPoint = {
  startAt: Date;
  endAt: Date;
  productionKwh: number;
  consumptionKwh: number;
  totalBuyCzkKwh: number;
  totalSellCzkKwh: number;
};

export type AnalysisBattery = {
  capacityKwh: number;
  maxChargeKw: number;
  maxDischargeKw: number;
  minSocPct: number;
  maxSocPct: number;
  roundtripEfficiencyPct: number;
};

export type AnalysisGrid = {
  maxImportKw: number | null;
  maxExportKw: number | null;
  exportAllowed: boolean;
};

export type AnalysisDispatchPeriod = {
  key: string;
  intervals: number;
  importKwh: number;
  exportKwh: number;
  chargedKwh: number;
  dischargedKwh: number;
  importCostCzk: number;
  exportRevenueCzk: number;
  variableCostCzk: number;
};

export type AnalysisDispatchResult = {
  importKwh: number;
  exportKwh: number;
  chargedKwh: number;
  dischargedKwh: number;
  curtailedKwh: number;
  unservedKwh: number;
  variableCostCzk: number;
  importCostCzk: number;
  exportRevenueCzk: number;
  peakImportKw: number;
  batteryCycles: number;
  endingSocKwh: number;
  strategy: "SELF_USE" | "SMART_HEURISTIC" | "SMART_SELF_USE_FALLBACK" | "SMART_MILP";
  periods?: {
    monthly: AnalysisDispatchPeriod[];
    daily: AnalysisDispatchPeriod[];
  };
};

function finiteNonNegative(value: number, code: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(code);
  return value;
}

function validate(points: AnalysisDispatchPoint[], battery: AnalysisBattery, grid: AnalysisGrid) {
  finiteNonNegative(battery.capacityKwh, "ANALYSIS_INVALID_BATTERY_CAPACITY");
  finiteNonNegative(battery.maxChargeKw, "ANALYSIS_INVALID_BATTERY_CHARGE_POWER");
  finiteNonNegative(battery.maxDischargeKw, "ANALYSIS_INVALID_BATTERY_DISCHARGE_POWER");
  if (battery.minSocPct < 0 || battery.maxSocPct > 100 || battery.minSocPct > battery.maxSocPct) throw new Error("ANALYSIS_INVALID_SOC_LIMITS");
  if (battery.roundtripEfficiencyPct <= 0 || battery.roundtripEfficiencyPct > 100) throw new Error("ANALYSIS_INVALID_EFFICIENCY");
  if (grid.maxImportKw !== null) finiteNonNegative(grid.maxImportKw, "ANALYSIS_INVALID_GRID_IMPORT");
  if (grid.maxExportKw !== null) finiteNonNegative(grid.maxExportKw, "ANALYSIS_INVALID_GRID_EXPORT");
  for (const point of points) {
    finiteNonNegative(point.productionKwh, "ANALYSIS_INVALID_PRODUCTION");
    finiteNonNegative(point.consumptionKwh, "ANALYSIS_INVALID_CONSUMPTION");
    if (!Number.isFinite(point.totalBuyCzkKwh) || !Number.isFinite(point.totalSellCzkKwh)) throw new Error("ANALYSIS_INVALID_PRICE");
    if (point.endAt <= point.startAt) throw new Error("ANALYSIS_INVALID_INTERVAL");
  }
}

function round(value: number, digits = 6) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function createDispatchPeriodAccumulator(
  timezone = "Europe/Prague",
) {
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const monthly = new Map<string, AnalysisDispatchPeriod>();
  const daily = new Map<string, AnalysisDispatchPeriod>();
  const keyFor = (date: Date) => {
    const parts = Object.fromEntries(
      dateParts
        .formatToParts(date)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const addTo = (
    target: Map<string, AnalysisDispatchPeriod>,
    key: string,
    value: Omit<AnalysisDispatchPeriod, "key" | "intervals" | "variableCostCzk">,
  ) => {
    const current = target.get(key) ?? {
      key,
      intervals: 0,
      importKwh: 0,
      exportKwh: 0,
      chargedKwh: 0,
      dischargedKwh: 0,
      importCostCzk: 0,
      exportRevenueCzk: 0,
      variableCostCzk: 0,
    };
    current.intervals += 1;
    current.importKwh += value.importKwh;
    current.exportKwh += value.exportKwh;
    current.chargedKwh += value.chargedKwh;
    current.dischargedKwh += value.dischargedKwh;
    current.importCostCzk += value.importCostCzk;
    current.exportRevenueCzk += value.exportRevenueCzk;
    current.variableCostCzk =
      current.importCostCzk - current.exportRevenueCzk;
    target.set(key, current);
  };
  const rounded = (items: Map<string, AnalysisDispatchPeriod>) =>
    [...items.values()]
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((item) => ({
        ...item,
        importKwh: round(item.importKwh),
        exportKwh: round(item.exportKwh),
        chargedKwh: round(item.chargedKwh),
        dischargedKwh: round(item.dischargedKwh),
        importCostCzk: round(item.importCostCzk, 2),
        exportRevenueCzk: round(item.exportRevenueCzk, 2),
        variableCostCzk: round(item.variableCostCzk, 2),
      }));
  return {
    add(
      startAt: Date,
      value: Omit<
        AnalysisDispatchPeriod,
        "key" | "intervals" | "variableCostCzk"
      >,
    ) {
      const dayKey = keyFor(startAt);
      addTo(daily, dayKey, value);
      addTo(monthly, dayKey.slice(0, 7), value);
    },
    result() {
      return { monthly: rounded(monthly), daily: rounded(daily) };
    },
  };
}

function dispatch(input: {
  points: AnalysisDispatchPoint[];
  battery: AnalysisBattery;
  grid: AnalysisGrid;
  strategy: "SELF_USE" | "SMART_HEURISTIC";
  timezone?: string;
}) {
  validate(input.points, input.battery, input.grid);
  const { battery, grid, points } = input;
  const minSoc = battery.capacityKwh * battery.minSocPct / 100;
  const maxSoc = battery.capacityKwh * battery.maxSocPct / 100;
  const eta = Math.sqrt(battery.roundtripEfficiencyPct / 100);
  let soc = minSoc;
  let importKwh = 0;
  let exportKwh = 0;
  let chargedKwh = 0;
  let dischargedKwh = 0;
  let curtailedKwh = 0;
  let unservedKwh = 0;
  let variableCostCzk = 0;
  let importCostCzk = 0;
  let exportRevenueCzk = 0;
  let peakImportKw = 0;
  const periods = createDispatchPeriodAccumulator(input.timezone);

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    let intervalChargedKwh = 0;
    let intervalDischargedKwh = 0;
    const hours = (point.endAt.getTime() - point.startAt.getTime()) / 3_600_000;
    const chargeLimit = Math.min(battery.maxChargeKw * hours, (maxSoc - soc) / eta);
    const dischargeLimit = Math.min(battery.maxDischargeKw * hours, (soc - minSoc) * eta);
    let surplus = Math.max(0, point.productionKwh - point.consumptionKwh);
    let deficit = Math.max(0, point.consumptionKwh - point.productionKwh);

    let futureMaximumBuy = point.totalBuyCzkKwh;
    let futureDeficit = 0;
    let arbitrageWorthwhile = false;
    if (input.strategy === "SMART_HEURISTIC") {
      const horizonEnd = point.startAt.getTime() + 34 * 3_600_000;
      for (let futureIndex = index + 1; futureIndex < points.length && points[futureIndex].startAt.getTime() < horizonEnd; futureIndex += 1) {
        const candidate = points[futureIndex];
        futureMaximumBuy = Math.max(futureMaximumBuy, candidate.totalBuyCzkKwh);
        futureDeficit += Math.max(0, candidate.consumptionKwh - candidate.productionKwh);
      }
      arbitrageWorthwhile = futureMaximumBuy * eta > point.totalBuyCzkKwh / eta + 0.01;
    }

    if (surplus > 0 && battery.capacityKwh > 0) {
      const store = Math.min(surplus, chargeLimit);
      soc += store * eta;
      chargedKwh += store;
      intervalChargedKwh += store;
      surplus -= store;
    }

    if (input.strategy === "SMART_HEURISTIC" && deficit === 0 && battery.capacityKwh > 0 && arbitrageWorthwhile) {
      const remainingChargeLimit = Math.min(battery.maxChargeKw * hours, (maxSoc - soc) / eta);
      const desiredStored = Math.min(maxSoc - soc, futureDeficit / Math.max(eta, 0.01));
      const gridCharge = Math.min(remainingChargeLimit, desiredStored / eta);
      if (gridCharge > 0) {
        soc += gridCharge * eta;
        chargedKwh += gridCharge;
        intervalChargedKwh += gridCharge;
        deficit += gridCharge;
      }
    }

    if (deficit > 0 && battery.capacityKwh > 0) {
      const preserveForMoreExpensive = input.strategy === "SMART_HEURISTIC"
        && futureMaximumBuy > point.totalBuyCzkKwh / Math.max(eta, 0.01) + 0.05;
      if (!preserveForMoreExpensive) {
        const deliver = Math.min(deficit, dischargeLimit);
        soc -= deliver / eta;
        dischargedKwh += deliver;
        intervalDischargedKwh += deliver;
        deficit -= deliver;
      }
    }

    const importLimit = grid.maxImportKw === null ? Number.POSITIVE_INFINITY : grid.maxImportKw * hours;
    const imported = Math.min(deficit, importLimit);
    const unmet = Math.max(0, deficit - imported);
    // A historical cost analysis cannot silently pretend an overloaded main
    // breaker did not exist. It records the excess as unserved energy;
    // scenario eligibility can then be rejected by the caller.
    unservedKwh += unmet;
    const exportLimit = !grid.exportAllowed
      ? 0
      : grid.maxExportKw === null ? Number.POSITIVE_INFINITY : grid.maxExportKw * hours;
    const exported = Math.min(surplus, exportLimit);
    curtailedKwh += Math.max(0, surplus - exported);
    importKwh += imported;
    exportKwh += exported;
    peakImportKw = Math.max(peakImportKw, imported / hours);
    importCostCzk += imported * point.totalBuyCzkKwh;
    exportRevenueCzk += exported * point.totalSellCzkKwh;
    variableCostCzk = importCostCzk - exportRevenueCzk;
    periods.add(point.startAt, {
      importKwh: imported,
      exportKwh: exported,
      chargedKwh: intervalChargedKwh,
      dischargedKwh: intervalDischargedKwh,
      importCostCzk: imported * point.totalBuyCzkKwh,
      exportRevenueCzk: exported * point.totalSellCzkKwh,
    });
  }

  return {
    importKwh: round(importKwh),
    exportKwh: round(exportKwh),
    chargedKwh: round(chargedKwh),
    dischargedKwh: round(dischargedKwh),
    curtailedKwh: round(curtailedKwh),
    unservedKwh: round(unservedKwh),
    variableCostCzk: round(variableCostCzk, 2),
    importCostCzk: round(importCostCzk, 2),
    exportRevenueCzk: round(exportRevenueCzk, 2),
    peakImportKw: round(peakImportKw, 3),
    batteryCycles: battery.capacityKwh > 0 ? round(dischargedKwh / battery.capacityKwh, 3) : 0,
    endingSocKwh: round(soc),
    strategy: input.strategy,
    periods: periods.result(),
  } satisfies AnalysisDispatchResult;
}

export function simulateSelfUse(
  points: AnalysisDispatchPoint[],
  battery: AnalysisBattery,
  grid: AnalysisGrid,
  timezone?: string,
) {
  return dispatch({ points, battery, grid, strategy: "SELF_USE", timezone });
}

export function simulateSmartEstimate(points: AnalysisDispatchPoint[], battery: AnalysisBattery, grid: AnalysisGrid) {
  const selfUse = simulateSelfUse(points, battery, grid);
  const smart = dispatch({ points, battery, grid, strategy: "SMART_HEURISTIC" });
  if (smart.variableCostCzk <= selfUse.variableCostCzk) return smart;
  return { ...selfUse, strategy: "SMART_SELF_USE_FALLBACK" } satisfies AnalysisDispatchResult;
}
