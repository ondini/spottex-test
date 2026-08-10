import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { breakerMonthlyFee, tariffDailyLowHours } from "./materialize";

describe("catalog price curve materialization", () => {
  it("resolves both supported audited breaker table shapes", () => {
    expect(breakerMonthlyFee({ "3x25": 269 }, 3, 25)).toBe(269);
    expect(breakerMonthlyFee({ "3": { "25": 271.5 } }, 3, 25)).toBe(271.5);
  });

  it("never silently substitutes an unknown breaker fee", () => {
    expect(() => breakerMonthlyFee({ "3x20": 200 }, 3, 25)).toThrow("PRICE_CURVE_BREAKER_FEE_MISSING");
  });

  it("models low-tariff duration by the compared distribution rate", () => {
    expect(tariffDailyLowHours("D02d")).toBe(0);
    expect(tariffDailyLowHours("D25d")).toBe(8);
    expect(tariffDailyLowHours("D27d")).toBe(8);
    expect(tariffDailyLowHours("D57d")).toBe(20);
  });
});
