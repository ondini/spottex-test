import { describe, expect, it } from "vitest";

import { calculateRenewalAmount, recurringRetryAt } from "./recurring-policy";

describe("recurring renewals", () => {
  it("never raises the previous paid price without a new consent", () => {
    expect(calculateRenewalAmount({ previousPaidMinor: 25_000, latestOfferMinor: 60_000, mandateMaximumMinor: 99_000, globalMaximumMinor: 99_000 })).toBe(25_000);
  });

  it("uses a lower newly calculated offer and always respects the global cap", () => {
    expect(calculateRenewalAmount({ previousPaidMinor: 99_000, latestOfferMinor: 17_500, mandateMaximumMinor: 99_000, globalMaximumMinor: 99_000 })).toBe(17_500);
    expect(calculateRenewalAmount({ previousPaidMinor: 200_000, latestOfferMinor: null, mandateMaximumMinor: 200_000, globalMaximumMinor: 99_000 })).toBe(99_000);
  });

  it("allows three attempts with increasing retry spacing", () => {
    const now = new Date("2026-07-21T12:00:00.000Z");
    expect(recurringRetryAt(now, 1)?.toISOString()).toBe("2026-07-22T12:00:00.000Z");
    expect(recurringRetryAt(now, 2)?.toISOString()).toBe("2026-07-24T12:00:00.000Z");
    expect(recurringRetryAt(now, 3)).toBeNull();
  });
});
