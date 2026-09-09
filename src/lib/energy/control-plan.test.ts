import { describe, expect, it } from "vitest";

import { describeControlPlan } from "./control-plan";

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
