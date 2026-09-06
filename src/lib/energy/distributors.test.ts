import { describe, expect, it } from "vitest";

import { normalizeDistributorCode } from "./distributors";

describe("normalizeDistributorCode", () => {
  it("maps the invoice spellings of the three operators to canonical codes", () => {
    expect(normalizeDistributorCode("ČEZ")).toBe("CEZ_DISTRIBUCE");
    expect(normalizeDistributorCode("ČEZ Distribuce, a. s.")).toBe("CEZ_DISTRIBUCE");
    expect(normalizeDistributorCode("cez distribuce")).toBe("CEZ_DISTRIBUCE");
    expect(normalizeDistributorCode("EG.D, s.r.o.")).toBe("EGD_DISTRIBUCE");
    expect(normalizeDistributorCode("E.ON Distribuce")).toBe("EGD_DISTRIBUCE");
    expect(normalizeDistributorCode("PREdistribuce, a. s.")).toBe("PRE_DISTRIBUCE");
    expect(normalizeDistributorCode("PRE")).toBe("PRE_DISTRIBUCE");
  });

  it("passes canonical codes and unknown text through, and drops blanks", () => {
    expect(normalizeDistributorCode("cez_distribuce")).toBe("CEZ_DISTRIBUCE");
    expect(normalizeDistributorCode("Neznámý distributor")).toBe("Neznámý distributor");
    expect(normalizeDistributorCode("   ")).toBeNull();
    expect(normalizeDistributorCode(null)).toBeNull();
  });
});
