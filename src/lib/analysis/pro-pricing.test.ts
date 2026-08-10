import { describe, expect, it } from "vitest";

import { calculateProAnalysisPriceMinor } from "./pro-pricing";

describe("Pro analysis pricing", () => {
  it("adds hardware points and the flat all-catalog comparison", () => {
    expect(
      calculateProAnalysisPriceMinor({
        billablePointCount: 7,
        compareAllTariffs: true,
      }),
    ).toBe(17_000);
  });
});
