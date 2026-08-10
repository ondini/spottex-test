import { describe, expect, it } from "vitest";

import { applyHdoExtreme, modeledHdoDefinition, type HdoSensitivityPricePoint } from "./hdo-sensitivity";

const point: HdoSensitivityPricePoint = {
  startAt: new Date("2026-01-01T00:00:00Z"), endAt: new Date("2026-01-01T00:15:00Z"),
  productionKwh: 0, consumptionKwh: 1,
  commodityBuyCzkKwh: 3, commoditySellCzkKwh: 1,
  distributionCzkKwh: 2, otherRegulatedCzkKwh: 0.5,
  totalBuyCzkKwh: 5.5, totalSellCzkKwh: 1,
};

describe("HDO sensitivity prices", () => {
  it("rebuilds both commodity and distribution prices for all-VT/all-NT bounds", () => {
    const definition = {
      distributionVtCzkKwh: 2,
      distributionNtCzkKwh: 0.2,
      buy: { mode: "FIX", vtCzkKwh: 3, ntCzkKwh: 2.5 },
      sell: { mode: "FIX", vtCzkKwh: 1, ntCzkKwh: 0.8 },
    };
    expect(applyHdoExtreme([point], definition, false)[0]).toMatchObject({ totalBuyCzkKwh: 5.5, totalSellCzkKwh: 1 });
    expect(applyHdoExtreme([point], definition, true)[0]).toMatchObject({ totalBuyCzkKwh: 3.2, totalSellCzkKwh: 0.8 });
  });

  it("keeps spot commodity prices and changes only distribution", () => {
    const definition = {
      distributionVtCzkKwh: 2,
      distributionNtCzkKwh: 0.2,
      buy: { mode: "SPOT", vtCzkKwh: null, ntCzkKwh: null },
      sell: { mode: "SPOT", vtCzkKwh: null, ntCzkKwh: null },
    };
    expect(applyHdoExtreme([point], definition, true)[0]).toMatchObject({ totalBuyCzkKwh: 3.7, totalSellCzkKwh: 1 });
  });

  it("builds sensitivity inputs from a self-contained modeled curve", () => {
    expect(modeledHdoDefinition({
      commodityBuyVtCzkKwh: 3.7,
      commodityBuyNtCzkKwh: 3.3,
      commoditySellCzkKwh: 0,
      distributionVtCzkKwh: 0.51,
      distributionNtCzkKwh: 0.21,
    })).toEqual({
      distributionVtCzkKwh: 0.51,
      distributionNtCzkKwh: 0.21,
      buy: { mode: "FIX", vtCzkKwh: 3.7, ntCzkKwh: 3.3 },
      sell: { mode: "FIX", vtCzkKwh: 0, ntCzkKwh: 0 },
    });
    expect(modeledHdoDefinition({ commodityBuyVtCzkKwh: 3.7 })).toBeNull();
  });
});
