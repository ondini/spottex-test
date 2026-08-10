import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { summarizeEnergyDataQuality } from "./data-quality";

function intervals(count: number, skip = new Set<number>()) {
  const start = new Date("2026-01-01T00:00:00.000Z");
  return Array.from({ length: count }, (_, index) => ({
    startAt: new Date(start.getTime() + index * 900_000),
    endAt: new Date(start.getTime() + (index + 1) * 900_000),
    kwh: 0,
  })).filter((_, index) => !skip.has(index));
}

describe("energy data quality", () => {
  it("requires matching production and consumption intervals", () => {
    const quality = summarizeEnergyDataQuality({
      production: intervals(96 * 8),
      consumption: intervals(96 * 8, new Set([10, 11])),
      minimumDays: 7,
    });
    expect(quality).toMatchObject({
      matchedIntervals: 766,
      missingIntervals: 2,
      readyForEstimate: true,
      confidence: "LOW",
    });
    expect(quality.message).toContain("8 úplných dní dat");
  });

  it("rejects a short or non-15-minute cache", () => {
    const production = intervals(96 * 2);
    production[0] = { ...production[0], endAt: new Date(production[0].startAt.getTime() + 60 * 60_000) };
    const quality = summarizeEnergyDataQuality({ production, consumption: intervals(96 * 2), minimumDays: 7 });
    expect(quality.readyForEstimate).toBe(false);
    expect(quality.invalidDurationIntervals).toBe(1);
  });

  it("detects duplicate starts and overlapping intervals before simulation", () => {
    const production = intervals(96 * 8);
    production.push({ ...production[10] });
    const consumption = intervals(96 * 8);
    consumption[20] = { ...consumption[20], endAt: new Date(consumption[20].endAt.getTime() + 15 * 60_000) };
    const quality = summarizeEnergyDataQuality({ production, consumption, minimumDays: 7 });
    expect(quality).toMatchObject({
      duplicateIntervals: 1,
      overlappingIntervals: 2,
      readyForEstimate: false,
    });
  });

  it("reports 30/90/365-day coverage and rejects an inconsistent complete energy balance", () => {
    const production = intervals(96 * 30).map((item) => ({ ...item, kwh: 1 }));
    const consumption = intervals(96 * 30).map((item) => ({ ...item, kwh: 0.5 }));
    const battery = intervals(96 * 30).map((item) => ({ ...item, kwh: 0 }));
    const gridImport = intervals(96 * 30).map((item) => ({ ...item, kwh: 0 }));
    const gridExport = intervals(96 * 30).map((item, index) => ({ ...item, kwh: index < 200 ? 0 : 0.5 }));
    const quality = summarizeEnergyDataQuality({ production, consumption, battery, gridImport, gridExport, minimumDays: 7 });
    expect(quality.coverageWindows).toEqual([
      { days: 30, matchedIntervals: 2880, expectedIntervals: 2880, coveragePercent: 100 },
      { days: 90, matchedIntervals: 2880, expectedIntervals: 8640, coveragePercent: 33.3 },
      { days: 365, matchedIntervals: 2880, expectedIntervals: 35040, coveragePercent: 8.2 },
    ]);
    expect(quality.balanceEvaluatedIntervals).toBe(2880);
    expect(quality.balanceInvalidIntervals).toBe(200);
    expect(quality.measuredConsumptionKwh).toBe(1440);
    expect(quality.annualizedConsumptionKwh).toBe(17_520);
    expect(quality.gridMeasuredDays).toBe(30);
    expect(quality.readyForEstimate).toBe(false);
    expect(quality.message).toContain("Energetická bilance nesedí");
  });
});
