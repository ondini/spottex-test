import { describe, expect, it } from "vitest";

import { evaluateEnergyCost } from "./cost";

describe("energy cost evaluation", () => {
  it("keeps commodity, distribution, fixed fees and export revenue separate", () => {
    const startAt = new Date("2026-01-01T00:00:00.000Z");
    const result = evaluateEnergyCost({
      flows: [{ startAt, importKwh: 2, exportKwh: 0.5 }],
      prices: [{
        startAt,
        endAt: new Date("2026-01-01T00:15:00.000Z"),
        commodityBuyCzkKwh: 3,
        commoditySellCzkKwh: 1.5,
        distributionCzkKwh: 2,
        otherRegulatedCzkKwh: 0.5,
        totalBuyCzkKwh: 5.5,
        totalSellCzkKwh: 1.5,
      }],
      monthlyFixedCzk: 100,
      periodFrom: startAt,
      periodTo: new Date("2027-01-01T00:00:00.000Z"),
    });
    expect(result).toEqual({
      importedKwh: 2,
      exportedKwh: 0.5,
      commodityBuyCzk: 6,
      distributionCzk: 4,
      regulatedCzk: 1,
      fixedCzk: 1200,
      exportRevenueCzk: 0.75,
      importCostCzk: 11,
      totalCzk: 1210.25,
    });
  });

  it("fails instead of silently pricing a missing interval", () => {
    expect(() => evaluateEnergyCost({
      flows: [{ startAt: new Date("2026-01-01T00:00:00.000Z"), importKwh: 1, exportKwh: 0 }],
      prices: [],
      monthlyFixedCzk: 0,
      periodFrom: new Date("2026-01-01T00:00:00.000Z"),
      periodTo: new Date("2026-01-02T00:00:00.000Z"),
    })).toThrow("ENERGY_COST_MISSING_PRICE");
  });
});
