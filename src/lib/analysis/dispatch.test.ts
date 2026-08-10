import { describe, expect, it } from "vitest";

import { simulateSelfUse, simulateSmartEstimate, type AnalysisDispatchPoint } from "./dispatch";

const battery = { capacityKwh: 10, maxChargeKw: 10, maxDischargeKw: 10, minSocPct: 0, maxSocPct: 100, roundtripEfficiencyPct: 100 };
const grid = { maxImportKw: null, maxExportKw: null, exportAllowed: true };

function point(hour: number, productionKwh: number, consumptionKwh: number, buy: number, sell = 0.5): AnalysisDispatchPoint {
  const startAt = new Date(Date.UTC(2026, 0, 1, hour));
  return { startAt, endAt: new Date(startAt.getTime() + 3_600_000), productionKwh, consumptionKwh, totalBuyCzkKwh: buy, totalSellCzkKwh: sell };
}

describe("analysis dispatch", () => {
  it("moves solar surplus to a later deficit in self-use", () => {
    const result = simulateSelfUse([point(10, 5, 0, 4), point(11, 0, 5, 4)], battery, grid);
    expect(result.importKwh).toBe(0);
    expect(result.exportKwh).toBe(0);
    expect(result.dischargedKwh).toBe(5);
  });

  it("charges from a cheap interval for an expensive future interval", () => {
    const points = [point(0, 0, 0, 1), point(1, 0, 5, 8)];
    const selfUse = simulateSelfUse(points, battery, grid);
    const smart = simulateSmartEstimate(points, battery, grid);
    expect(smart.variableCostCzk).toBeLessThan(selfUse.variableCostCzk);
    expect(smart.importKwh).toBe(5);
  });

  it("respects a zero-export connection", () => {
    const result = simulateSelfUse([point(10, 20, 0, 4)], { ...battery, capacityKwh: 0 }, { ...grid, exportAllowed: false });
    expect(result.exportKwh).toBe(0);
    expect(result.curtailedKwh).toBe(20);
    expect(result.unservedKwh).toBe(0);
  });

  it("never reports a smart estimate worse than self-use", () => {
    const points = [point(0, 0, 4, 8), point(1, 0, 4, 1)];
    const selfUse = simulateSelfUse(points, battery, grid);
    const smart = simulateSmartEstimate(points, battery, grid);
    expect(smart.variableCostCzk).toBeLessThanOrEqual(selfUse.variableCostCzk);
  });

  it("marks demand above the main-breaker limit as unserved instead of a saving", () => {
    const result = simulateSelfUse(
      [point(0, 0, 5, 8)],
      { ...battery, capacityKwh: 0 },
      { ...grid, maxImportKw: 2 },
    );
    expect(result.importKwh).toBe(2);
    expect(result.unservedKwh).toBe(3);
    expect(result.importCostCzk).toBe(16);
  });

  it("keeps daily and monthly evidence consistent with the aggregate result", () => {
    const points = [
      point(10, 5, 0, 4, 1),
      point(11, 0, 3, 4, 1),
      {
        ...point(10, 0, 4, 2, 1),
        startAt: new Date(Date.UTC(2026, 1, 1, 10)),
        endAt: new Date(Date.UTC(2026, 1, 1, 11)),
      },
    ];
    const result = simulateSelfUse(points, battery, grid, "Europe/Prague");
    const monthly = result.periods?.monthly ?? [];
    const daily = result.periods?.daily ?? [];

    expect(monthly).toHaveLength(2);
    expect(daily).toHaveLength(2);
    expect(monthly.reduce((sum, period) => sum + period.importCostCzk, 0))
      .toBe(result.importCostCzk);
    expect(monthly.reduce((sum, period) => sum + period.exportRevenueCzk, 0))
      .toBe(result.exportRevenueCzk);
    expect(monthly.reduce((sum, period) => sum + period.chargedKwh, 0))
      .toBe(result.chargedKwh);
    expect(monthly.reduce((sum, period) => sum + period.dischargedKwh, 0))
      .toBe(result.dischargedKwh);
  });
});
