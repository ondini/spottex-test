import { describe, expect, it } from "vitest";

import { formatMoney, productFreeTrialDays } from "./cart";

const normalizeSpaces = (value: string) => value.replace(/\s/g, " ");

describe("commerce formatting", () => {
  it("formats minor Czech-crown units without losing halers", () => {
    expect(normalizeSpaces(formatMoney(12_345))).toBe("123,45 Kč");
  });

  it("supports negative values and another ISO currency", () => {
    expect(normalizeSpaces(formatMoney(-50, "EUR"))).toBe("-0,50 €");
  });
});

describe("subscription offer metadata", () => {
  it("accepts a bounded free-trial period", () => {
    expect(productFreeTrialDays({ freeTrialDays: 30 })).toBe(30);
    expect(productFreeTrialDays({ freeTrialDays: 0 })).toBe(0);
    expect(productFreeTrialDays({ freeTrialDays: 3651 })).toBe(0);
    expect(productFreeTrialDays({ freeTrialDays: "not-a-number" })).toBe(0);
  });
});
