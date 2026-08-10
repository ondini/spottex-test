import { describe, expect, it } from "vitest";

import { aggregateDashboardSnapshots } from "./dashboard-aggregate";
import type { EnergyDashboardSnapshot } from "./types";

function snapshot(
  productionKwh: number,
  consumptionKwh: number,
): EnergyDashboardSnapshot {
  return {
    generatedAt: "2026-07-27T12:00:00.000Z",
    dataAsOf: "2026-07-27T12:00:00.000Z",
    dataTimestampKind: "MEASURED",
    source: "LIVE",
    stale: false,
    warning: null,
    issues: [],
    sites: [],
    selectedSiteId: 1,
    inverterCount: 1,
    current: {
      productionKw: productionKwh * 4,
      consumptionKw: consumptionKwh * 4,
      gridKw: 0,
      batteryKw: 0,
      batterySocPct: 50,
      batteryCapacityKwh: null,
      pvCapacityKwp: 20,
      buyPriceCzk: null,
      sellPriceCzk: null,
    },
    dailySeries: [
      {
        at: "2026-07-27T11:00:00.000Z",
        endAt: "2026-07-27T11:15:00.000Z",
        predicted: false,
        productionKwh,
        consumptionKwh,
        batteryKwh: 0,
        gridImportKwh: 0,
        gridExportKwh: 0,
      },
    ],
    savings: { todayCzk: 0, weekCzk: 0, monthCzk: 0, yearCzk: 0 },
    schedule: [],
    history: {
      importStatus: "COMPLETED",
      progressPercent: 100,
      importedPoints: 1,
      totalChunks: 1,
      succeededChunks: 1,
      failedChunks: 0,
      dataFrom: null,
      dataTo: null,
      coverageDays: 0,
      spanDays: 0,
      coveragePercent: 0,
      confidence: "NONE",
      readyForEstimate: false,
      minimumDays: 7,
      message: "",
    },
  };
}

describe("multi-inverter dashboard aggregation", () => {
  it("derives site load from the shared grid meter instead of adding vendor load", () => {
    const primary = snapshot(2.3, 0);
    primary.dailySeries[0].gridExportKwh = 1;
    primary.dailySeries[0].batteryKwh = -0.3;
    primary.current.gridKw = -4;
    primary.current.batteryKw = -1.2;
    const secondary = snapshot(1.1, 1.3);
    const result = aggregateDashboardSnapshots([primary, secondary]);
    expect(result.inverterCount).toBe(2);
    expect(result.dailySeries[0]).toMatchObject({
      productionKwh: 3.4,
      consumptionKwh: 2.1,
    });
    expect(result.current.productionKw).toBeCloseTo(13.6);
    expect(result.current.consumptionKw).toBeCloseTo(8.4);
  });

  it("keeps vendor consumption as a fallback when an energy-flow section is missing", () => {
    const primary = snapshot(2.3, 0);
    primary.issues.push({ section: "history", message: "Chybí historie toku." });
    const result = aggregateDashboardSnapshots([primary, snapshot(1.1, 1.3)]);
    expect(result.dailySeries[0].consumptionKwh).toBe(1.3);
  });

  it("keeps forecast consumption independent when future flows are unavailable", () => {
    const primary = snapshot(1.2, 0.25);
    const secondary = snapshot(0.8, 0.15);
    primary.dailySeries[0].predicted = true;
    secondary.dailySeries[0].predicted = true;

    const result = aggregateDashboardSnapshots([primary, secondary]);

    expect(result.dailySeries[0].productionKwh).toBeCloseTo(2);
    expect(result.dailySeries[0].consumptionKwh).toBeCloseTo(0.4);
  });
});
