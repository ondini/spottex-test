import { describe, expect, it } from "vitest";

import type { AnalysisDispatchPoint } from "./dispatch";
import {
  guardSmartResult,
  ROLLING_MILP_METHOD_VERSION,
  simulateRollingMilp,
} from "./rolling-milp";

const battery = { capacityKwh: 10, maxChargeKw: 10, maxDischargeKw: 10, minSocPct: 0, maxSocPct: 100, roundtripEfficiencyPct: 100 };
const grid = { maxImportKw: 20, maxExportKw: 20, exportAllowed: true };

function points(days: number): AnalysisDispatchPoint[] {
  return Array.from({ length: days * 4 }, (_, index) => {
    const startAt = new Date(Date.UTC(2026, 0, 1, index));
    const hour = index % 4;
    return { startAt, endAt: new Date(startAt.getTime() + 3_600_000), productionKwh: 0, consumptionKwh: hour === 3 ? 5 : 0, totalBuyCzkKwh: hour === 0 ? 1 : hour === 3 ? 8 : 4, totalSellCzkKwh: 0.5 };
  });
}

describe("rolling MILP backtest", () => {
  it("replans every planning interval using only the profile observed before that interval", async () => {
    const result = await simulateRollingMilp({ points: points(3), battery, grid, horizonHours: 4 });
    expect(result.solverCalls).toBe(3);
    expect(result.solverFallbacks).toBe(0);
    expect(result.forecastMethod).toContain(ROLLING_MILP_METHOD_VERSION);
    expect(result.forecastQuality.neuralCandidate).toBe("NOT_CONFIGURED");
    expect(result.unservedKwh).toBe(0);
  });

  it("coarsens replanning for long backtests to respect the solver budget", async () => {
    const result = await simulateRollingMilp({
      points: points(10),
      battery,
      grid,
      horizonHours: 24,
      maxSolverCalls: 2,
    });

    expect(result.solverCalls).toBeLessThanOrEqual(2);
    expect(result.replanHours).toBeGreaterThan(4);
    expect(result.unservedKwh).toBe(0);
  });

  it("does not merge non-contiguous 15-minute data into an invalid hourly planning point", async () => {
    const start = new Date("2026-06-01T00:00:00.000Z");
    const gapped = Array.from({ length: 16 }, (_, index) => ({
      startAt: new Date(start.getTime() + index * 15 * 60_000),
      endAt: new Date(start.getTime() + (index + 1) * 15 * 60_000),
      productionKwh: index % 4 === 0 ? 1 : 0,
      consumptionKwh: index % 4 === 3 ? 1 : 0.25,
      totalBuyCzkKwh: index < 8 ? 2 : 6,
      totalSellCzkKwh: 0,
    })).filter((_, index) => index !== 7);

    const result = await simulateRollingMilp({
      points: gapped,
      battery,
      grid,
      horizonHours: 4,
      planningResolutionMinutes: 60,
    });

    // Each contiguous segment fits into one four-hour execution plan; the
    // short bucket before the gap prevents cached actions from crossing it.
    expect(result.solverCalls).toBe(2);
    expect(result.solverFallbacks).toBe(0);
    expect(result.unservedKwh).toBe(0);
  });

  it("never returns a more expensive dispatch than self-use", async () => {
    const flat = points(3).map((point) => ({
      ...point,
      totalBuyCzkKwh: 6,
      totalSellCzkKwh: 0,
    }));

    const result = await simulateRollingMilp({
      points: flat,
      battery,
      grid,
      horizonHours: 4,
    });

    expect(result.variableCostCzk).toBeLessThanOrEqual(90);
  });

  it("falls back to the self-use dispatch when an optimized candidate is worse", () => {
    const baseResult = {
      importKwh: 1,
      exportKwh: 0,
      chargedKwh: 0,
      dischargedKwh: 0,
      curtailedKwh: 0,
      unservedKwh: 0,
      variableCostCzk: 90,
      importCostCzk: 90,
      exportRevenueCzk: 0,
      peakImportKw: 1,
      batteryCycles: 0,
      endingSocKwh: 0,
      strategy: "SELF_USE" as const,
    };
    const guarded = guardSmartResult(
      {
        ...baseResult,
        variableCostCzk: 100,
        importCostCzk: 100,
        strategy: "SMART_MILP",
        solverCalls: 1,
      },
      baseResult,
    );

    expect(guarded.strategy).toBe("SMART_SELF_USE_FALLBACK");
    expect(guarded.variableCostCzk).toBe(90);
    expect(
      (
        guarded as typeof guarded & {
          smartCandidateVariableCostCzk: number;
        }
      ).smartCandidateVariableCostCzk,
    ).toBe(100);
    expect(guarded.solverCalls).toBe(1);
  });

  it("keeps the physical import limit in the application against real data", async () => {
    const result = await simulateRollingMilp({ points: points(1), battery: { ...battery, capacityKwh: 0 }, grid: { ...grid, maxImportKw: 2 }, horizonHours: 4 });
    expect(result.unservedKwh).toBe(3);
    expect(result.peakImportKw).toBe(2);
    expect(result.solverCalls).toBe(0);
  });

  it("applies planned curtailment instead of exporting at a negative sell price", async () => {
    const start = new Date("2026-06-01T10:00:00.000Z");
    const surplus = [0, 1].map((_, index) => ({
      startAt: new Date(start.getTime() + index * 15 * 60_000),
      endAt: new Date(start.getTime() + (index + 1) * 15 * 60_000),
      productionKwh: 1,
      consumptionKwh: 0,
      totalBuyCzkKwh: 2,
      totalSellCzkKwh: -1,
    }));
    const result = await simulateRollingMilp({
      points: surplus,
      battery: { ...battery, capacityKwh: 0 },
      grid,
      warmupIntervals: 1,
    });
    expect(result.exportKwh).toBe(0);
    expect(result.curtailedKwh).toBe(1);
  });

  it("stops before solving when the durable worker timeout aborts the run", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(simulateRollingMilp({ points: points(1), battery, grid, signal: controller.signal })).rejects.toThrow("ANALYSIS_ROLLING_ABORTED");
  });
});
