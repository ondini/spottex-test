import { describe, expect, it } from "vitest";

import { batteryOptions, runSimulation } from "./engine";

const day = Array.from({ length: 24 }, (_, hour) => ({
  at: new Date(Date.UTC(2026, 5, 1, hour)),
  productionKwh: hour >= 8 && hour <= 17 ? 1.2 : 0,
  consumptionKwh: hour >= 17 && hour <= 22 ? 1.1 : 0.35,
  intervalHours: 1,
}));

describe("simulation engine", () => {
  it("builds the requested battery multiples around the current plant", () => {
    expect(batteryOptions(10)).toEqual([10, 12.5, 15, 17.5, 20, 25, 30]);
    expect(batteryOptions(5)).toEqual([5, 6.5, 7.5, 9, 10, 12.5, 15]);
  });

  it("produces a persisted-size tariff and expansion matrix", () => {
    const result = runSimulation(
      {
        siteId: 1,
        currentBatteryKwh: 10,
        currentPvKwp: 10,
        batteryPriceCzkPerKwh: 15_000,
        pvPriceCzkPerKwp: 25_000,
        exportPriceCzkPerKwh: 0.5,
      },
      day,
      new Date("2026-07-14T10:00:00Z"),
    );

    expect(result.scenarios).toHaveLength(4 * 7 * 3);
    expect(result.bestScenario).toBeTruthy();
    expect(result.data).toMatchObject({ coverageDays: 1, confidence: "LOW" });
    expect(result.assumptions.join(" ")).toContain("AQUA SPP");
  });
});

