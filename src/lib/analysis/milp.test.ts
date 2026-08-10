import { describe, expect, it } from "vitest";

import type { AnalysisDispatchPoint } from "./dispatch";
import { optimizeMilpHorizon } from "./milp";

const battery = { capacityKwh: 10, maxChargeKw: 10, maxDischargeKw: 10, minSocPct: 0, maxSocPct: 100, roundtripEfficiencyPct: 100 };
const grid = { maxImportKw: 10, maxExportKw: 10, exportAllowed: true };

function point(hour: number, productionKwh: number, consumptionKwh: number, buy: number, sell = 0.5): AnalysisDispatchPoint {
  const startAt = new Date(Date.UTC(2026, 0, 1, hour));
  return { startAt, endAt: new Date(startAt.getTime() + 3_600_000), productionKwh, consumptionKwh, totalBuyCzkKwh: buy, totalSellCzkKwh: sell };
}

describe("MILP horizon optimizer", () => {
  it("moves cheap energy into an expensive interval and preserves terminal SoC", async () => {
    const plan = await optimizeMilpHorizon({ points: [point(0, 0, 0, 1), point(1, 0, 5, 8)], battery, grid, initialSocKwh: 0 });
    expect(plan.status).toBe("OPTIMAL");
    expect(plan.points[0].chargeKwh).toBeCloseTo(5);
    expect(plan.points[1].dischargeKwh).toBeCloseTo(5);
    expect(plan.points[1].endingSocKwh).toBeCloseTo(0);
  });

  it("includes the documented battery wear shadow price in dispatch decisions", async () => {
    const plan = await optimizeMilpHorizon({ points: [point(0, 0, 0, 1), point(1, 0, 5, 2)], battery, grid, initialSocKwh: 0 });
    expect(plan.points[0].chargeKwh).toBeCloseTo(0);
    expect(plan.points[1].dischargeKwh).toBeCloseTo(0);
  });

  it("does not manufacture revenue by importing and exporting simultaneously", async () => {
    const plan = await optimizeMilpHorizon({ points: [point(0, 0, 0, -2, 3)], battery: { ...battery, capacityKwh: 0 }, grid, initialSocKwh: 0 });
    expect(plan.points[0].importKwh * plan.points[0].exportKwh).toBe(0);
  });

  it("reports physically unserved demand when the connection is too small", async () => {
    const plan = await optimizeMilpHorizon({ points: [point(0, 0, 5, 4)], battery: { ...battery, capacityKwh: 0 }, grid: { ...grid, maxImportKw: 2 }, initialSocKwh: 0 });
    expect(plan.points[0].importKwh).toBeCloseTo(2);
    expect(plan.points[0].unservedKwh).toBeCloseTo(3);
  });
});
