import { describe, expect, it } from "vitest";

import type { AnalysisDispatchPoint } from "./dispatch";
import { createForecastRuntime, selectForecastPolicy } from "./forecast";

function patterned(days: number): AnalysisDispatchPoint[] {
  return Array.from({ length: days * 96 }, (_, index) => {
    const startAt = new Date(Date.UTC(2026, 0, 12, 0, index * 15));
    const weekday = startAt.getUTCDay();
    const slot = index % 96;
    const work = weekday > 0 && weekday < 6;
    return {
      startAt,
      endAt: new Date(startAt.getTime() + 900_000),
      productionKwh: slot >= 32 && slot <= 64 ? Math.sin((slot - 32) / 32 * Math.PI) : 0,
      consumptionKwh: work ? (slot >= 28 && slot <= 68 ? 2 : 0.2) : 0.4,
      totalBuyCzkKwh: 4,
      totalSellCzkKwh: 1,
    };
  });
}

describe("time-correct forecast selection", () => {
  it("selects a validated simple profile and records error and coverage", () => {
    const selection = selectForecastPolicy(patterned(70), "UTC");
    expect(selection.consumption.selected).toBe("DAY_TYPE_28D");
    expect(selection.consumption.metrics.find((item) => item.method === "DAY_TYPE_28D")).toMatchObject({ maeKwh: 0 });
    expect(selection.consumption.metrics.find((item) => item.method === "DAY_TYPE_28D")!.coveragePct).toBeGreaterThan(95);
    expect(selection.neuralCandidate).toBe("NOT_CONFIGURED");
  });

  it("does not let a long-horizon persistence lookup see observations after the origin", () => {
    const points = patterned(10);
    const selection = { ...selectForecastPolicy(points, "UTC"), consumption: { selected: "PERSISTENCE_24H" as const, metrics: [] }, production: { selected: "PERSISTENCE_24H" as const, metrics: [] } };
    const runtime = createForecastRuntime(selection, "UTC");
    points.slice(0, 96).forEach(runtime.observe);
    const future = { ...points[0], startAt: new Date(points[95].startAt.getTime() + 34 * 3_600_000) };
    expect(runtime.forecast(future).consumptionKwh).toBeGreaterThanOrEqual(0);
  });
});
