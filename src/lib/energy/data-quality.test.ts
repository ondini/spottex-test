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

  it("explains sparse cloud history after enough equivalent days were measured", () => {
    const first = intervals(96 * 4);
    const last = intervals(96 * 4).map((item) => ({
      ...item,
      startAt: new Date(item.startAt.getTime() + 26 * 86_400_000),
      endAt: new Date(item.endAt.getTime() + 26 * 86_400_000),
    }));
    const sparse = [...first, ...last];
    const quality = summarizeEnergyDataQuality({
      production: sparse,
      consumption: sparse,
      minimumDays: 7,
    });

    expect(quality).toMatchObject({
      coverageDays: 8,
      readyForEstimate: false,
      confidence: "LOW",
    });
    expect(quality.message).toContain("v časovém rozsahu historie pokrývají jen");
    expect(quality.message).toContain("SolaX cloud");
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
    // The first 200 windows export only a fifth of the surplus: a real mismatch, not a feed gap.
    const gridExport = intervals(96 * 30).map((item, index) => ({ ...item, kwh: index < 200 ? 0.1 : 0.5 }));
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

  it("treats all-zero battery and grid windows with a surplus as feed gaps, not as a wrong balance", () => {
    // Saffronela: the live feed reports neither battery nor grid for many
    // windows and the legacy series fills them with zeros. Those windows must
    // not block the analysis, which simulates battery and grid itself.
    const production = intervals(96 * 8).map((item) => ({ ...item, kwh: 1 }));
    const consumption = intervals(96 * 8).map((item) => ({ ...item, kwh: 0.5 }));
    const zeros = () => intervals(96 * 8).map((item) => ({ ...item, kwh: 0 }));
    const quality = summarizeEnergyDataQuality({ production, consumption, battery: zeros(), gridImport: zeros(), gridExport: zeros(), minimumDays: 7 });
    expect(quality.balanceUnmeasuredIntervals).toBe(768);
    expect(quality.balanceEvaluatedIntervals).toBe(0);
    expect(quality.balanceInvalidIntervals).toBe(0);
    expect(quality.readyForEstimate).toBe(true);
  });

  it("only informs, never blocks, when battery and grid cover a small tail of a long history", () => {
    // A year of cloud history for production and consumption, battery and
    // grid only from the live feed of the last ten days, sampled differently:
    // the mismatch is not evidence about the history's signs or units.
    const span = 96 * 60;
    const production = intervals(span).map((item) => ({ ...item, kwh: 1 }));
    const consumption = intervals(span).map((item) => ({ ...item, kwh: 0.5 }));
    const tail = (kwh: number) => intervals(span).slice(span - 96 * 10).map((item) => ({ ...item, kwh }));
    const quality = summarizeEnergyDataQuality({ production, consumption, battery: tail(0), gridImport: tail(0), gridExport: tail(0.1), minimumDays: 7 });
    expect(quality.balanceEvaluatedIntervals).toBe(960);
    expect(quality.balanceInvalidIntervals).toBe(960);
    expect(quality.readyForEstimate).toBe(true);
  });

  it("opens the estimate on recent complete days even when the whole span is sparse", () => {
    const now = new Date("2026-09-06T00:00:00.000Z");
    const day = 86_400_000;
    const base = new Date("2026-01-01T00:00:00.000Z").getTime();
    const shift = (items: ReturnType<typeof intervals>, offsetMs: number) =>
      items.map((item) => ({ ...item, startAt: new Date(item.startAt.getTime() + offsetMs), endAt: new Date(item.endAt.getTime() + offsetMs) }));
    // Twelve sparse days a year ago, then 35 complete days ending yesterday.
    const old = shift(intervals(96 * 12), now.getTime() - 300 * day - base);
    const recent = shift(intervals(96 * 35), now.getTime() - 36 * day - base);
    const data = [...old, ...recent];
    const quality = summarizeEnergyDataQuality({ production: data, consumption: data, minimumDays: 7, now });
    expect(quality.recentCompleteDays).toBe(35);
    expect(quality.coveragePercent).toBeLessThan(75);
    expect(quality.readyForEstimate).toBe(true);
    expect(quality.confidence).toBe("LOW");
    expect(quality.message).toContain("za posledních 90 dní");
  });

  it("keeps a sparse and stale history blocked and says how many recent days are needed", () => {
    const now = new Date("2026-09-06T00:00:00.000Z");
    const day = 86_400_000;
    const base = new Date("2026-01-01T00:00:00.000Z").getTime();
    const shift = (items: ReturnType<typeof intervals>, offsetMs: number) =>
      items.map((item) => ({ ...item, startAt: new Date(item.startAt.getTime() + offsetMs), endAt: new Date(item.endAt.getTime() + offsetMs) }));
    const data = [
      ...shift(intervals(96 * 6), now.getTime() - 320 * day - base),
      ...shift(intervals(96 * 6), now.getTime() - 150 * day - base),
    ];
    const quality = summarizeEnergyDataQuality({ production: data, consumption: data, minimumDays: 7, now });
    expect(quality.recentCompleteDays).toBe(0);
    expect(quality.readyForEstimate).toBe(false);
    expect(quality.message).toContain("30 úplných dní za posledních 90 dní");
  });
});
