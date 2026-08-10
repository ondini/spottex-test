import GLPK, { type LP } from "glpk.js/node";

import type { AnalysisBattery, AnalysisDispatchPoint, AnalysisGrid } from "./dispatch";

export const MILP_ENGINE_VERSION = "SPOTTEX_GLPK_ROLLING_V2";
export const DEFAULT_BATTERY_CYCLE_COST_CZK_KWH = 1.2;

export type MilpPlanPoint = {
  startAt: Date;
  endAt: Date;
  importKwh: number;
  exportKwh: number;
  chargeKwh: number;
  dischargeKwh: number;
  curtailedKwh: number;
  unservedKwh: number;
  endingSocKwh: number;
};

export type MilpPlan = {
  status: "OPTIMAL" | "FEASIBLE";
  objectiveCzk: number;
  points: MilpPlanPoint[];
  solverVersion: string;
};

let glpkPromise: ReturnType<typeof GLPK> | null = null;

function solver() {
  glpkPromise ??= GLPK();
  return glpkPromise;
}

function positive(value: number, code: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(code);
  return value;
}

function variable(prefix: string, index: number) {
  return `${prefix}_${index}`;
}

export async function optimizeMilpHorizon(input: {
  points: AnalysisDispatchPoint[];
  battery: AnalysisBattery;
  grid: AnalysisGrid;
  initialSocKwh: number;
  cycleCostCzkKwh?: number;
  timeLimitSeconds?: number;
}): Promise<MilpPlan> {
  if (!input.points.length || input.points.length > 192) throw new Error("MILP_INVALID_HORIZON");
  const glpk = await solver();
  const eta = Math.sqrt(input.battery.roundtripEfficiencyPct / 100);
  const minSoc = input.battery.capacityKwh * input.battery.minSocPct / 100;
  const maxSoc = input.battery.capacityKwh * input.battery.maxSocPct / 100;
  if (!Number.isFinite(eta) || eta <= 0 || eta > 1 || input.initialSocKwh < minSoc - 1e-6 || input.initialSocKwh > maxSoc + 1e-6) throw new Error("MILP_INVALID_BATTERY");
  const objective: LP["objective"]["vars"] = [];
  const subjectTo: LP["subjectTo"] = [];
  const bounds: NonNullable<LP["bounds"]> = [];
  const binaries: string[] = [];
  const cycleCost = positive(input.cycleCostCzkKwh ?? DEFAULT_BATTERY_CYCLE_COST_CZK_KWH, "MILP_INVALID_CYCLE_COST");

  input.points.forEach((point, index) => {
    const hours = (point.endAt.getTime() - point.startAt.getTime()) / 3_600_000;
    if (!Number.isFinite(hours) || hours <= 0 || hours > 1) throw new Error("MILP_INVALID_INTERVAL");
    for (const [value, code] of [[point.productionKwh, "MILP_INVALID_PRODUCTION"], [point.consumptionKwh, "MILP_INVALID_CONSUMPTION"]] as const) positive(value, code);
    if (!Number.isFinite(point.totalBuyCzkKwh) || !Number.isFinite(point.totalSellCzkKwh)) throw new Error("MILP_INVALID_PRICE");
    const names = {
      imp: variable("imp", index), exp: variable("exp", index), charge: variable("charge", index), discharge: variable("discharge", index),
      curtail: variable("curtail", index), unserved: variable("unserved", index), soc: variable("soc", index), batteryMode: variable("battery_mode", index), gridMode: variable("grid_mode", index),
    };
    const chargeMax = Math.min(input.battery.maxChargeKw * hours, input.battery.capacityKwh);
    const dischargeMax = Math.min(input.battery.maxDischargeKw * hours, input.battery.capacityKwh);
    const importMax = input.grid.maxImportKw == null
      ? Math.max(point.consumptionKwh + chargeMax, 1)
      : input.grid.maxImportKw * hours;
    const exportMax = !input.grid.exportAllowed ? 0 : input.grid.maxExportKw == null
      ? Math.max(point.productionKwh + dischargeMax, 1)
      : input.grid.maxExportKw * hours;
    bounds.push(
      { name: names.imp, type: glpk.GLP_DB, lb: 0, ub: importMax },
      { name: names.exp, type: glpk.GLP_DB, lb: 0, ub: exportMax },
      { name: names.charge, type: glpk.GLP_DB, lb: 0, ub: chargeMax },
      { name: names.discharge, type: glpk.GLP_DB, lb: 0, ub: dischargeMax },
      { name: names.curtail, type: glpk.GLP_DB, lb: 0, ub: point.productionKwh },
      { name: names.unserved, type: glpk.GLP_DB, lb: 0, ub: point.consumptionKwh },
      { name: names.soc, type: glpk.GLP_DB, lb: minSoc, ub: maxSoc },
    );
    objective.push(
      { name: names.imp, coef: point.totalBuyCzkKwh },
      { name: names.exp, coef: -point.totalSellCzkKwh },
      { name: names.discharge, coef: cycleCost },
      { name: names.unserved, coef: 1_000_000 },
      { name: names.curtail, coef: 0.000001 },
    );
    subjectTo.push({
      name: `balance_${index}`,
      vars: [
        { name: names.imp, coef: 1 }, { name: names.discharge, coef: 1 }, { name: names.unserved, coef: 1 },
        { name: names.charge, coef: -1 }, { name: names.exp, coef: -1 }, { name: names.curtail, coef: -1 },
      ],
      bnds: { type: glpk.GLP_FX, lb: point.consumptionKwh - point.productionKwh, ub: point.consumptionKwh - point.productionKwh },
    });
    subjectTo.push({
      name: `soc_balance_${index}`,
      vars: [
        { name: names.soc, coef: 1 },
        ...(index > 0 ? [{ name: variable("soc", index - 1), coef: -1 }] : []),
        { name: names.charge, coef: -eta },
        { name: names.discharge, coef: 1 / eta },
      ],
      bnds: { type: glpk.GLP_FX, lb: index === 0 ? input.initialSocKwh : 0, ub: index === 0 ? input.initialSocKwh : 0 },
    });
    // With a non-negative import price, simultaneous charging and discharging
    // can only waste energy and increase the objective (cycle wear is positive),
    // so the LP relaxation is already exact. A binary is still required for a
    // negative import price: without it the model could manufacture paid load by
    // cycling the battery inside one interval. Keeping binaries only where they
    // are mathematically necessary makes an annual rolling backtest practical.
    if (chargeMax > 0 && dischargeMax > 0 && point.totalBuyCzkKwh < 0) {
      binaries.push(names.batteryMode);
      subjectTo.push(
        { name: `charge_mode_${index}`, vars: [{ name: names.charge, coef: 1 }, { name: names.batteryMode, coef: -chargeMax }], bnds: { type: glpk.GLP_UP, lb: 0, ub: 0 } },
        { name: `discharge_mode_${index}`, vars: [{ name: names.discharge, coef: 1 }, { name: names.batteryMode, coef: dischargeMax }], bnds: { type: glpk.GLP_UP, lb: 0, ub: dischargeMax } },
      );
    }
    // Import/export netting is exact whenever buying is at least as expensive as
    // selling. If a non-standard curve reverses that spread, retain the binary so
    // the optimizer cannot create a same-interval grid arbitrage loop.
    if (importMax > 0 && exportMax > 0 && point.totalSellCzkKwh > point.totalBuyCzkKwh) {
      binaries.push(names.gridMode);
      subjectTo.push(
        { name: `import_mode_${index}`, vars: [{ name: names.imp, coef: 1 }, { name: names.gridMode, coef: -importMax }], bnds: { type: glpk.GLP_UP, lb: 0, ub: 0 } },
        { name: `export_mode_${index}`, vars: [{ name: names.exp, coef: 1 }, { name: names.gridMode, coef: exportMax }], bnds: { type: glpk.GLP_UP, lb: 0, ub: exportMax } },
      );
    }
  });
  subjectTo.push({ name: "terminal_soc", vars: [{ name: variable("soc", input.points.length - 1), coef: 1 }], bnds: { type: glpk.GLP_LO, lb: input.initialSocKwh, ub: 0 } });
  const model: LP = { name: MILP_ENGINE_VERSION, objective: { direction: glpk.GLP_MIN, name: "cost", vars: objective }, subjectTo, bounds, binaries };
  const solved = glpk.solve(model, { msglev: glpk.GLP_MSG_OFF, presol: true, mipgap: 0.001, tmlim: input.timeLimitSeconds ?? 10 });
  if (![glpk.GLP_OPT, glpk.GLP_FEAS].includes(solved.result.status)) throw new Error(`MILP_SOLVER_STATUS_${solved.result.status}`);
  const value = (prefix: string, index: number) => Math.max(0, solved.result.vars[variable(prefix, index)] ?? 0);
  return {
    status: solved.result.status === glpk.GLP_OPT ? "OPTIMAL" : "FEASIBLE",
    objectiveCzk: solved.result.z,
    solverVersion: `GLPK ${glpk.version}`,
    points: input.points.map((point, index) => ({
      startAt: point.startAt,
      endAt: point.endAt,
      importKwh: value("imp", index),
      exportKwh: value("exp", index),
      chargeKwh: value("charge", index),
      dischargeKwh: value("discharge", index),
      curtailedKwh: value("curtail", index),
      unservedKwh: value("unserved", index),
      endingSocKwh: value("soc", index),
    })),
  };
}
