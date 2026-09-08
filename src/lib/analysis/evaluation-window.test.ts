import { describe, expect, it } from "vitest";

import { chooseEvaluationWindow, evaluationPeriodLabel, periodFactor, pragueMonthStart } from "./evaluation-window";

describe("evaluation window", () => {
  const window = { from: new Date("2025-09-30T22:00:00.000Z"), to: new Date("2026-09-08T10:00:00.000Z") };

  it("keeps the whole window and scales to a year with ten months or more", () => {
    const chosen = chooseEvaluationWindow({ window, coverageDays: 320, monthlyCoverage: [] });
    expect(chosen).toEqual({ ...window, annual: true, months: [] });
  });

  it("narrows to the complete calendar months when the year is far from complete", () => {
    const chosen = chooseEvaluationWindow({
      window,
      coverageDays: 190,
      monthlyCoverage: [
        { month: "2026-05", coveragePercent: 40 },
        { month: "2026-06", coveragePercent: 97 },
        { month: "2026-07", coveragePercent: 99 },
        { month: "2026-08", coveragePercent: 55 },
      ],
    });
    expect(chosen.annual).toBe(false);
    expect(chosen.months).toEqual(["2026-06", "2026-07"]);
    expect(chosen.from.toISOString()).toBe("2026-05-31T22:00:00.000Z");
    expect(chosen.to.toISOString()).toBe("2026-07-31T22:00:00.000Z");
    expect(evaluationPeriodLabel({ annual: false, from: chosen.from, to: chosen.to })).toBe("červen–červenec 2026");
  });

  it("falls back to the measured days when no month is complete", () => {
    const chosen = chooseEvaluationWindow({ window, coverageDays: 25, monthlyCoverage: [{ month: "2026-08", coveragePercent: 60 }] });
    expect(chosen.annual).toBe(false);
    expect(chosen.months).toEqual([]);
    expect(evaluationPeriodLabel({ annual: false, from: window.from, to: window.to })).toBe("1. 10. 2025 – 8. 9. 2026");
  });

  it("labels years and scales period amounts", () => {
    expect(evaluationPeriodLabel({ annual: true, from: null, to: null })).toBe("rok");
    expect(periodFactor(true, 100)).toBe(1);
    expect(periodFactor(false, 61)).toBeCloseTo(61 / 365, 6);
    expect(pragueMonthStart(2026, 1).toISOString()).toBe("2025-12-31T23:00:00.000Z");
  });

  it("does not count the running month as complete even when its days so far are all measured", () => {
    const window = chooseEvaluationWindow({
      window: { from: new Date("2025-10-24T10:45:00Z"), to: new Date("2026-09-08T11:45:00Z") },
      coverageDays: 190,
      monthlyCoverage: [
        { month: "2026-05", coveragePercent: 82 },
        { month: "2026-06", coveragePercent: 96 },
        { month: "2026-07", coveragePercent: 92 },
        { month: "2026-08", coveragePercent: 95 },
        { month: "2026-09", coveragePercent: 100 },
      ],
    });
    expect(window.annual).toBe(false);
    expect(window.months).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(window.from.toISOString()).toBe("2026-05-31T22:00:00.000Z");
    expect(window.to.toISOString()).toBe("2026-08-31T22:00:00.000Z");
    expect(evaluationPeriodLabel({ annual: false, from: window.from, to: window.to })).toBe("červen–srpen 2026");
  });
});
