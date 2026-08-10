import type {
  SimulationInput,
  SimulationPoint,
  SimulationResult,
  SimulationScenario,
  SimulationTariffCode,
} from "./types";

const COMMON_REGULATED_CZK_KWH = 0.0283 + 0.17092;
const TARIFFS: Record<
  SimulationTariffCode,
  { label: string; note: string; vt: number; nt: number; ntHours: number }
> = {
  C03d: {
    label: "C03d · jednotarif",
    note: "Jednotarifní srovnávací varianta.",
    vt: 2.95868 + 0.99315 + COMMON_REGULATED_CZK_KWH,
    nt: 2.95868 + 0.99315 + COMMON_REGULATED_CZK_KWH,
    ntHours: 0,
  },
  C25d: {
    label: "C25d · akumulace 8 h",
    note: "Modelové NT okno 22:00–06:00; nárok na sazbu je nutné ověřit.",
    vt: 3.04959 + 2.20839 + COMMON_REGULATED_CZK_KWH,
    nt: 2.85124 + 0.1165 + COMMON_REGULATED_CZK_KWH,
    ntHours: 8,
  },
  C26d: {
    label: "C26d · akumulace 8 h",
    note: "Modelové NT okno 22:00–06:00; nárok na sazbu je nutné ověřit.",
    vt: 3.04959 + 1.30261 + COMMON_REGULATED_CZK_KWH,
    nt: 2.85124 + 0.1165 + COMMON_REGULATED_CZK_KWH,
    ntHours: 8,
  },
};

function round(value: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function option(value: number): number {
  return Math.round(value * 2) / 2;
}

export function batteryOptions(current: number): number[] {
  if (current <= 0) return [0, 5, 7.5, 10, 12.5, 15];
  return [...new Set([1, 1.25, 1.5, 1.75, 2, 2.5, 3].map((factor) => option(current * factor)))];
}

export function pvOptions(current: number): number[] {
  return [...new Set([1, 1.25, 1.5, 2].map((factor) => option(current * factor)))];
}

function isLowTariff(code: SimulationTariffCode, hour: number): boolean {
  return TARIFFS[code].ntHours > 0 && (hour >= 22 || hour < 6);
}

function futureDeficit(points: SimulationPoint[], index: number, pvScale: number): number {
  let deficit = 0;
  const horizon = Math.min(points.length, index + 24);
  for (let cursor = index + 1; cursor < horizon; cursor += 1) {
    const point = points[cursor];
    if (isLowTariff("C25d", point.at.getHours())) break;
    deficit += Math.max(0, point.consumptionKwh - point.productionKwh * pvScale);
  }
  return deficit;
}

function dispatchCost(input: {
  points: SimulationPoint[];
  pvScale: number;
  batteryKwh: number;
  tariff: SimulationTariffCode;
  exportPrice: number;
  smart: boolean;
}): number {
  const { points, pvScale, batteryKwh, tariff, exportPrice, smart } = input;
  const lowSoc = batteryKwh * 0.05;
  const highSoc = batteryKwh * 0.95;
  const efficiency = 0.95;

  const run = (startingSoc: number) => {
    let soc = startingSoc;
    let cost = 0;
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const pv = point.productionKwh * pvScale;
      let deficit = Math.max(0, point.consumptionKwh - pv);
      let surplus = Math.max(0, pv - point.consumptionKwh);
      const maxBatteryFlow = batteryKwh * 0.5 * point.intervalHours;
      const lowTariff = isLowTariff(tariff, point.at.getHours());

      if (batteryKwh > 0 && surplus > 0) {
        const fromSurplus = Math.min(surplus, maxBatteryFlow, (highSoc - soc) / efficiency);
        soc += fromSurplus * efficiency;
        surplus -= fromSurplus;
      }

      if (batteryKwh > 0 && smart && lowTariff) {
        const target = Math.min(highSoc, lowSoc + futureDeficit(points, index, pvScale) / efficiency);
        const gridCharge = Math.min(maxBatteryFlow, Math.max(0, target - soc) / efficiency);
        if (gridCharge > 0) {
          soc += gridCharge * efficiency;
          deficit += gridCharge;
        }
      }

      const mayDischarge = !smart || !lowTariff || TARIFFS[tariff].ntHours === 0;
      if (batteryKwh > 0 && deficit > 0 && mayDischarge) {
        const delivered = Math.min(deficit, maxBatteryFlow, (soc - lowSoc) * efficiency);
        soc -= delivered / efficiency;
        deficit -= delivered;
      }

      const buyPrice = lowTariff ? TARIFFS[tariff].nt : TARIFFS[tariff].vt;
      cost += deficit * buyPrice - surplus * exportPrice;
    }
    return { cost, soc };
  };

  // One warm-up pass removes most of the arbitrary initial-state bias for a
  // short imported history. Only the second pass is used in the result.
  const warmup = run(lowSoc);
  return run(warmup.soc).cost;
}

export function runSimulation(
  input: SimulationInput,
  rawPoints: SimulationPoint[],
  now = new Date(),
): SimulationResult {
  const points = rawPoints
    .filter(
      (point) =>
        Number.isFinite(point.productionKwh) &&
        Number.isFinite(point.consumptionKwh) &&
        point.productionKwh >= 0 &&
        point.consumptionKwh >= 0 &&
        point.intervalHours > 0,
    )
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  if (points.length < 12) throw new Error("SIMULATION_DATA_INSUFFICIENT");

  const coverageHours = points.reduce((sum, point) => sum + point.intervalHours, 0);
  const coverageDays = coverageHours / 24;
  const annualizationFactor = 365 / coverageDays;
  const currentPv = Math.max(0.5, input.currentPvKwp);
  const batteries = batteryOptions(input.currentBatteryKwh);
  const photovoltaics = pvOptions(currentPv);
  const tariffCodes = Object.keys(TARIFFS) as SimulationTariffCode[];
  const baselineMeasured = dispatchCost({
    points,
    pvScale: 1,
    batteryKwh: input.currentBatteryKwh,
    tariff: "C03d",
    exportPrice: input.exportPriceCzkPerKwh,
    smart: false,
  });
  const baselineAnnualCostCzk = baselineMeasured * annualizationFactor;

  const scenarios: SimulationScenario[] = [];
  for (const pvKwp of photovoltaics) {
    for (const batteryKwh of batteries) {
      for (const tariff of tariffCodes) {
        const common = {
          points,
          pvScale: pvKwp / currentPv,
          batteryKwh,
          tariff,
          exportPrice: input.exportPriceCzkPerKwh,
        };
        const selfUseAnnualCostCzk = dispatchCost({ ...common, smart: false }) * annualizationFactor;
        const smartAnnualCostCzk = dispatchCost({ ...common, smart: true }) * annualizationFactor;
        const investmentCzk =
          Math.max(0, batteryKwh - input.currentBatteryKwh) * input.batteryPriceCzkPerKwh +
          Math.max(0, pvKwp - input.currentPvKwp) * input.pvPriceCzkPerKwp;
        const annualSavingsCzk = baselineAnnualCostCzk - smartAnnualCostCzk;
        scenarios.push({
          tariff,
          pvKwp,
          batteryKwh,
          selfUseAnnualCostCzk: round(selfUseAnnualCostCzk),
          smartAnnualCostCzk: round(smartAnnualCostCzk),
          annualSavingsCzk: round(annualSavingsCzk),
          controlSavingsCzk: round(selfUseAnnualCostCzk - smartAnnualCostCzk),
          investmentCzk: round(investmentCzk),
          paybackYears:
            investmentCzk > 0 && annualSavingsCzk > 0
              ? round(investmentCzk / annualSavingsCzk, 1)
              : null,
        });
      }
    }
  }

  const bestScenario = [...scenarios].sort((a, b) => {
    const scoreA = a.annualSavingsCzk * 10 - a.investmentCzk;
    const scoreB = b.annualSavingsCzk * 10 - b.investmentCzk;
    return scoreB - scoreA || b.annualSavingsCzk - a.annualSavingsCzk;
  })[0];

  return {
    engineVersion: "SPOTTEX_FORECAST_V1",
    generatedAt: now.toISOString(),
    data: {
      from: points[0].at.toISOString(),
      to: points.at(-1)?.at.toISOString() ?? points[0].at.toISOString(),
      intervals: points.length,
      coverageDays: round(coverageDays, 1),
      annualizationFactor: round(annualizationFactor, 2),
      confidence: coverageDays >= 300 ? "HIGH" : coverageDays >= 30 ? "MEDIUM" : "LOW",
    },
    current: {
      batteryKwh: input.currentBatteryKwh,
      pvKwp: input.currentPvKwp,
      baselineAnnualCostCzk: round(baselineAnnualCostCzk),
    },
    batteryOptionsKwh: batteries,
    pvOptionsKwp: photovoltaics,
    tariffs: tariffCodes.map((code) => ({ code, label: TARIFFS[code].label, note: TARIFFS[code].note })),
    scenarios,
    bestScenario,
    assumptions: [
      "Výpočet používá skutečnou časovou řadu výroby a spotřeby uloženou ve Spottex.",
      "Chytré řízení je model prediktivního přesunu energie mezi VT a NT; nejde ještě o finální MILP návrh ani závaznou nabídku.",
      "Ceny jsou model ČEZ 2026 bez DPH převzatý ze studijní metodiky AQUA SPP; oprávněnost konkrétní sazby musí potvrdit distributor.",
      "Nízký tarif je bez HDO kalendáře konzervativně modelován v čase 22:00–06:00.",
      "Návratnost je prostá, bez financování, degradace, dotace a budoucího vývoje cen.",
    ],
  };
}

