import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { simulateSelfUse, type AnalysisDispatchPoint } from "../src/lib/analysis/dispatch";
import { DEFAULT_BATTERY_CYCLE_COST_CZK_KWH } from "../src/lib/analysis/milp";
import { simulateRollingMilp } from "../src/lib/analysis/rolling-milp";

async function main() {
const studyRoot = process.env.STUDY_ANALYSIS_ROOT ?? "/home/michal/Studie/aqua_spp_analyza";
const studyPython = process.env.STUDY_PYTHON ?? resolve(studyRoot, ".venv/bin/python");
const adapter = resolve(process.cwd(), "scripts/study-export-annual.py");
const annual = JSON.parse(execFileSync(studyPython, [adapter], {
  env: { ...process.env, STUDY_ANALYSIS_ROOT: studyRoot },
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})) as {
  intervalMinutes: number;
  startAt: string;
  loadKwh: number[];
  productionKwh: number[];
  buyCzkKwh: number[];
  sellCzkKwh: number[];
};

const lengths = [annual.loadKwh, annual.productionKwh, annual.buyCzkKwh, annual.sellCzkKwh].map((values) => values.length);
if (new Set(lengths).size !== 1 || lengths[0] < 300 * 96) throw new Error("STUDY_SMART_ANNUAL_INPUT_INCOMPLETE");
const intervalMs = annual.intervalMinutes * 60_000;
const first = new Date(annual.startAt).getTime();
const points: AnalysisDispatchPoint[] = annual.loadKwh.map((consumptionKwh, index) => {
  const startAt = new Date(first + index * intervalMs);
  return {
    startAt,
    endAt: new Date(startAt.getTime() + intervalMs),
    consumptionKwh,
    productionKwh: annual.productionKwh[index],
    totalBuyCzkKwh: annual.buyCzkKwh[index],
    totalSellCzkKwh: annual.sellCzkKwh[index],
  };
});

const capacityKwh = 100;
const warmupIntervals = 28 * 96;
const battery = {
  capacityKwh,
  maxChargeKw: 50,
  maxDischargeKw: 50,
  minSocPct: 5,
  maxSocPct: 95,
  roundtripEfficiencyPct: 90.25,
};
// The Study trace records breaker exceedances instead of clipping them, so the
// cross-implementation comparison must leave import unconstrained as well.
const grid = { maxImportKw: null, maxExportKw: 220, exportAllowed: true };
const startedAt = Date.now();
const smart = await simulateRollingMilp({
  points,
  battery,
  grid,
  timezone: "Europe/Prague",
  horizonHours: 34,
  planningResolutionMinutes: 60,
  warmupIntervals,
  cycleCostCzkKwh: DEFAULT_BATTERY_CYCLE_COST_CZK_KWH,
});
const evaluation = points.slice(warmupIntervals);
const selfUse = simulateSelfUse(evaluation, battery, grid);
const evaluatedDays = evaluation.length / 96;
const annualization = 365 / evaluatedDays;
const eta = Math.sqrt(battery.roundtripEfficiencyPct / 100);
const minSoc = battery.capacityKwh * battery.minSocPct / 100;
const balanceErrorKwh = Math.abs(
  evaluation.reduce((sum, point) => sum + point.productionKwh - point.consumptionKwh, 0)
    + smart.importKwh + smart.dischargedKwh - smart.exportKwh - smart.chargedKwh - smart.curtailedKwh,
);
const socErrorKwh = Math.abs(smart.endingSocKwh - (minSoc + smart.chargedKwh * eta - smart.dischargedKwh / eta));
if (smart.solverFallbacks !== 0) throw new Error(`STUDY_SMART_SOLVER_FALLBACK:${smart.solverFallbacks}`);
if (smart.unservedKwh > 0.000001) throw new Error(`STUDY_SMART_UNSERVED:${smart.unservedKwh}`);
if (balanceErrorKwh > 0.01 || socErrorKwh > 0.01) throw new Error(`STUDY_SMART_PHYSICS:${balanceErrorKwh}:${socErrorKwh}`);

const csv = readFileSync(resolve(studyRoot, "data_derived/sim_sweep_backend.csv"), "utf8").trim().split(/\r?\n/);
const headers = csv[0].split(",");
const references = csv.slice(1).map((line) => Object.fromEntries(line.split(",").map((value, index) => [headers[index], value])));
const reference = references.find((row) => row.variant === "existing" && Number(row.e_kwh) === capacityKwh && row.mode === "backend15");
if (!reference) throw new Error("STUDY_SMART_REFERENCE_MISSING");
const annualSmart = {
  importMwh: smart.importKwh * annualization / 1_000,
  exportMwh: smart.exportKwh * annualization / 1_000,
  cycles: smart.batteryCycles * annualization,
  costKczk: (smart.variableCostCzk + smart.dischargedKwh * DEFAULT_BATTERY_CYCLE_COST_CZK_KWH) * annualization / 1_000,
};
const deviationPct = (actual: number, expected: number) => Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-9) * 100;
const deviations = {
  importPct: deviationPct(annualSmart.importMwh, Number(reference.import_mwh)),
  exportPct: deviationPct(annualSmart.exportMwh, Number(reference.export_mwh)),
  cyclesPct: deviationPct(annualSmart.cycles, Number(reference.cycles)),
  costPct: deviationPct(annualSmart.costKczk, Number(reference.cost_kczk)),
};
// The old Study controller has intentionally different SoC safety margins and
// forecast implementation. This is a scale/sanity gate, while exact optimizer
// semantics are covered by the cross-solver golden fixtures.
if (deviations.importPct > 25 || deviations.exportPct > 60 || deviations.cyclesPct > 60 || deviations.costPct > 25)
  throw new Error(`STUDY_SMART_ANNUAL_REGRESSION:${JSON.stringify(deviations)}`);

process.stdout.write(`${JSON.stringify({
  intervals: points.length,
  evaluatedIntervals: evaluation.length,
  elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
  physics: { balanceErrorKwh, socErrorKwh, solverFallbacks: smart.solverFallbacks, unservedKwh: smart.unservedKwh },
  annualSmart,
  annualSelfUseCostKczk: selfUse.variableCostCzk * annualization / 1_000,
  studyReference: {
    importMwh: Number(reference.import_mwh),
    exportMwh: Number(reference.export_mwh),
    cycles: Number(reference.cycles),
    costKczk: Number(reference.cost_kczk),
  },
  deviations,
}, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
