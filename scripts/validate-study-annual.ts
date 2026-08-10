import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { simulateSelfUse, type AnalysisDispatchPoint } from "../src/lib/analysis/dispatch";

const studyRoot = process.env.STUDY_ANALYSIS_ROOT ?? "/home/michal/Studie/aqua_spp_analyza";
const adapter = resolve(process.cwd(), "scripts/study-export-annual.py");
const studyPython = process.env.STUDY_PYTHON ?? resolve(studyRoot, ".venv/bin/python");
const raw = execFileSync(studyPython, [adapter], {
  env: { ...process.env, STUDY_ANALYSIS_ROOT: studyRoot },
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});
const annual = JSON.parse(raw) as { intervalMinutes: number; startAt: string; loadKwh: number[]; productionKwh: number[] };
if (annual.loadKwh.length !== annual.productionKwh.length || annual.loadKwh.length < 300 * 96) throw new Error("STUDY_ANNUAL_INPUT_INCOMPLETE");

const intervalMs = annual.intervalMinutes * 60_000;
const first = new Date(annual.startAt).getTime();
const points: AnalysisDispatchPoint[] = annual.loadKwh.map((consumptionKwh, index) => {
  const startAt = new Date(first + index * intervalMs);
  return { startAt, endAt: new Date(startAt.getTime() + intervalMs), consumptionKwh, productionKwh: annual.productionKwh[index], totalBuyCzkKwh: 1, totalSellCzkKwh: 0 };
});

const csv = readFileSync(resolve(studyRoot, "data_derived/sim_sweep.csv"), "utf8").trim().split(/\r?\n/);
const headers = csv[0].split(",");
const reference = csv.slice(1).map((line) => Object.fromEntries(line.split(",").map((value, index) => [headers[index], value])));
const sizes = [0, 100, 300, 500, 1_000, 2_000, 4_000];
const tolerance = { energyPct: 0.15, cyclesPct: 0.75 };

function deviationPct(actual: number, expected: number) {
  if (Math.abs(expected) < 1e-9) return Math.abs(actual) < 1e-6 ? 0 : Number.POSITIVE_INFINITY;
  return Math.abs(actual - expected) / Math.abs(expected) * 100;
}

const loadMwh = annual.loadKwh.reduce((sum, value) => sum + value, 0) / 1_000;
const pvMwh = annual.productionKwh.reduce((sum, value) => sum + value, 0) / 1_000;
const rows = sizes.map((capacityKwh) => {
  const expected = reference.find((row) => row.variant === "existing" && Number(row.e_kwh) === capacityKwh && (capacityKwh === 0 ? row.mode === "spot" : row.mode === "greedy"));
  if (!expected) throw new Error(`STUDY_REFERENCE_MISSING:${capacityKwh}`);
  const result = simulateSelfUse(points, {
    capacityKwh,
    maxChargeKw: Math.min(capacityKwh * 0.5, 250),
    maxDischargeKw: Math.min(capacityKwh * 0.5, 250),
    minSocPct: 5,
    maxSocPct: 95,
    roundtripEfficiencyPct: 90.25,
  }, { maxImportKw: null, maxExportKw: 220, exportAllowed: true });
  const deviations = {
    load: deviationPct(loadMwh, Number(expected.load_mwh)),
    production: deviationPct(pvMwh, Number(expected.pv_mwh)),
    imported: deviationPct(result.importKwh / 1_000, Number(expected.import_mwh)),
    exported: deviationPct(result.exportKwh / 1_000, Number(expected.export_mwh)),
    cycles: capacityKwh ? deviationPct(result.batteryCycles, Number(expected.cycles)) : 0,
  };
  if (Math.max(deviations.load, deviations.production, deviations.imported, deviations.exported) > tolerance.energyPct || deviations.cycles > tolerance.cyclesPct) {
    throw new Error(`STUDY_ANNUAL_REGRESSION:${capacityKwh}:${JSON.stringify(deviations)}`);
  }
  return { capacityKwh, ...deviations };
});

process.stdout.write(`${JSON.stringify({ intervals: points.length, tolerance, rows }, null, 2)}\n`);
