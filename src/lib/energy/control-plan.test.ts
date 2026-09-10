import { describe, expect, it } from "vitest";

import { buildPlanOverlay, describeControlPlan } from "./control-plan";

const now = new Date("2026-09-09T19:00:00.000Z");

describe("control plan for the owner", () => {
  it("names the current block, trims overlapping older blocks and merges equal neighbours", () => {
    const plan = describeControlPlan([
      { startAt: "2026-09-09T10:30:00.000Z", endAt: "2026-09-09T16:00:00.000Z", mode: "Vlastní spotřeba", targetSocPct: 30, batteryKw: null },
      { startAt: "2026-09-09T15:15:00.000Z", endAt: "2026-09-09T16:00:00.000Z", mode: "Priorita přetoku do sítě", targetSocPct: 100, batteryKw: null },
      { startAt: "2026-09-09T16:00:00.000Z", endAt: "2026-09-10T22:00:00.000Z", mode: "Vlastní spotřeba", targetSocPct: 10.7, batteryKw: -12.5 },
      { startAt: "2026-09-09T18:45:00.000Z", endAt: "2026-09-11T04:00:00.000Z", mode: "Vlastní spotřeba", targetSocPct: 11.4, batteryKw: -13.5 },
    ], now);
    expect(plan.current?.mode).toBe("Vlastní spotřeba");
    expect(plan.current?.startAt).toBe("2026-09-09T16:00:00.000Z");
    expect(plan.current?.endAt).toBe("2026-09-11T04:00:00.000Z");
    expect(plan.upcoming).toEqual([]);
    expect(plan.allSelfUse).toBe(true);
  });

  it("keeps a charge block apart and reports the plan is not plain self-use", () => {
    const plan = describeControlPlan([
      { startAt: "2026-09-09T18:00:00.000Z", endAt: "2026-09-09T22:00:00.000Z", mode: "Vlastní spotřeba", targetSocPct: 20, batteryKw: null },
      { startAt: "2026-09-09T22:00:00.000Z", endAt: "2026-09-10T02:00:00.000Z", mode: "Vynucené nabíjení", targetSocPct: 90, batteryKw: 5 },
      { startAt: "2026-09-10T02:00:00.000Z", endAt: "2026-09-10T18:00:00.000Z", mode: "Vlastní spotřeba", targetSocPct: 20, batteryKw: null },
    ], now);
    expect(plan.upcoming.map((block) => block.mode)).toEqual(["Vynucené nabíjení", "Vlastní spotřeba"]);
    expect(plan.allSelfUse).toBe(false);
  });

  it("is empty when nothing is planned ahead", () => {
    const plan = describeControlPlan([{ startAt: "2026-09-09T10:00:00.000Z", endAt: "2026-09-09T12:00:00.000Z", mode: "Vlastní spotřeba", targetSocPct: null, batteryKw: null }], now);
    expect(plan.current).toBeNull();
    expect(plan.allSelfUse).toBe(false);
  });
});

describe("plan drawn into a chart", () => {
  const points = Array.from({ length: 8 }, (_value, index) => {
    const at = new Date(Date.UTC(2026, 8, 9, 18, index * 15)).toISOString();
    return { at, key: `k${index}` };
  });

  it("turns blocks into bands that start and end on drawn points, and marks each switch", () => {
    const overlay = buildPlanOverlay(
      [
        { startAt: points[0].at, endAt: points[3].at, mode: "Vlastní spotřeba", targetSocPct: 20, batteryKw: null },
        { startAt: points[3].at, endAt: points[6].at, mode: "Vynucené nabíjení", targetSocPct: 90, batteryKw: 5 },
        { startAt: points[6].at, endAt: new Date(Date.UTC(2026, 8, 9, 21, 0)).toISOString(), mode: "Vlastní spotřeba", targetSocPct: 10, batteryKw: null },
      ],
      points,
    );
    expect(overlay.segments.map((segment) => [segment.fromKey, segment.toKey])).toEqual([
      ["k0", "k2"],
      ["k3", "k5"],
      ["k6", "k7"],
    ]);
    expect(overlay.markers.map((marker) => marker.atKey)).toEqual(["k3", "k6"]);
    expect(overlay.markers[0].caption).toBe("Vynucené nabíjení · cíl 90 %");
    expect(overlay.markers[1].caption).toBe("Vlastní spotřeba · cíl 10 %");
    expect(overlay.modes).toEqual([
      { mode: "Vlastní spotřeba", color: "#82c651" },
      { mode: "Vynucené nabíjení", color: "#38bdf8" },
    ]);
  });

  it("ignores blocks that fall outside the drawn points and needs no marker at the left edge", () => {
    const overlay = buildPlanOverlay(
      [
        { startAt: new Date(Date.UTC(2026, 8, 9, 10, 0)).toISOString(), endAt: points[2].at, mode: "Vlastní spotřeba", targetSocPct: null, batteryKw: null },
        { startAt: new Date(Date.UTC(2026, 8, 10, 10, 0)).toISOString(), endAt: new Date(Date.UTC(2026, 8, 10, 12, 0)).toISOString(), mode: "Vynucené nabíjení", targetSocPct: 80, batteryKw: 4 },
      ],
      points,
    );
    expect(overlay.segments.map((segment) => segment.mode)).toEqual(["Vlastní spotřeba"]);
    expect(overlay.markers).toEqual([]);
  });
});
