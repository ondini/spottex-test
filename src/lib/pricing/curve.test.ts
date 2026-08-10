import { describe, expect, it } from "vitest";

import { generatePriceCurve, isConservativeNightLowTariff, type DistributionCurveInput } from "./curve";

const distribution: DistributionCurveInput = {
  distributionVtCzkKwh: 2.2,
  distributionNtCzkKwh: 0.2,
  systemServicesCzkKwh: 0.1,
  electricityTaxCzkKwh: 0.03,
  pozeCzkKwh: 0.17,
  monthlyMeterFeeCzk: 25,
  monthlyBreakerFeeCzk: 269,
};

describe("price curve generation", () => {
  it("combines FIX, HDO and regulated components without mixing sell revenue", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const result = generatePriceCurve({
      validFrom: from,
      validTo: new Date("2026-01-01T01:00:00.000Z"),
      resolutionMinutes: 15,
      product: {
        buyMode: "FIX",
        sellMode: "FIX",
        fixedBuyVtCzkKwh: 3,
        fixedBuyNtCzkKwh: 2.5,
        fixedSellVtCzkKwh: 1,
        fixedSellNtCzkKwh: 0.8,
        monthlyFeeCzk: 99,
      },
      distribution,
      hdo: [{ startAt: from, endAt: new Date("2026-01-01T00:30:00.000Z"), lowTariff: true }],
    });

    expect(result.monthlyFixedCzk).toBe(393);
    expect(result.points).toHaveLength(4);
    expect(result.points[0]).toMatchObject({ lowTariff: true, totalBuyCzkKwh: 3, totalSellCzkKwh: 0.8 });
    expect(result.points[2]).toMatchObject({ lowTariff: false, totalBuyCzkKwh: 5.5, totalSellCzkKwh: 1 });
  });

  it("supports negative spot prices and applies buy and sell fees in opposite directions", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const result = generatePriceCurve({
      validFrom: from,
      validTo: new Date("2026-01-01T01:00:00.000Z"),
      resolutionMinutes: 15,
      product: {
        buyMode: "SPOT",
        sellMode: "SPOT",
        spotBuyFeeCzkKwh: 0.2,
        spotSellFeeCzkKwh: 0.15,
        monthlyFeeCzk: 0,
      },
      distribution: { ...distribution, distributionVtCzkKwh: 0, distributionNtCzkKwh: 0 },
      hdo: [],
      marketPricesCzkMwh: [{ startAt: from, endAt: new Date("2026-01-01T01:00:00.000Z"), value: -500 }],
    });
    expect(result.points[0]).toMatchObject({
      commodityBuyCzkKwh: -0.3,
      commoditySellCzkKwh: -0.65,
      totalBuyCzkKwh: 0,
      totalSellCzkKwh: -0.65,
    });
  });

  it("rejects a spot curve with a missing market interval", () => {
    expect(() => generatePriceCurve({
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validTo: new Date("2026-01-01T00:15:00.000Z"),
      resolutionMinutes: 15,
      product: { buyMode: "SPOT", sellMode: "FIX", fixedSellVtCzkKwh: 1, monthlyFeeCzk: 0 },
      distribution,
      hdo: [],
    })).toThrow("PRICE_CURVE_MISSING_MARKET_POINT");
  });

  it("uses the declared conservative 22:00–05:00 local fallback only when HDO is unavailable", () => {
    expect(isConservativeNightLowTariff(new Date("2026-01-01T21:00:00.000Z"))).toBe(true);
    expect(isConservativeNightLowTariff(new Date("2026-01-01T05:00:00.000Z"))).toBe(false);
    const result = generatePriceCurve({
      validFrom: new Date("2026-01-01T20:00:00.000Z"),
      validTo: new Date("2026-01-01T22:00:00.000Z"),
      resolutionMinutes: 15,
      product: { buyMode: "FIX", sellMode: "FIX", fixedBuyVtCzkKwh: 3, fixedBuyNtCzkKwh: 2, fixedSellVtCzkKwh: 1, monthlyFeeCzk: 0 },
      distribution,
      hdo: [],
      hdoFallback: "NIGHT_22_05",
      timezone: "Europe/Prague",
    });
    expect(result.hdoSource).toBe("NIGHT_22_05");
    expect(result.points.slice(0, 4).every((point) => !point.lowTariff)).toBe(true);
    expect(result.points.slice(4).every((point) => point.lowTariff)).toBe(true);
  });
});
