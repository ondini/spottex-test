import type { AnalysisDispatchPoint } from "./dispatch";

export type HdoSensitivityPricePoint = AnalysisDispatchPoint & {
  commodityBuyCzkKwh: number;
  commoditySellCzkKwh: number;
  distributionCzkKwh: number;
  otherRegulatedCzkKwh: number;
};

export type HdoSensitivityDefinition = {
  distributionVtCzkKwh: number;
  distributionNtCzkKwh: number;
  buy: { mode: string; vtCzkKwh: number | null; ntCzkKwh: number | null };
  sell: { mode: string; vtCzkKwh: number | null; ntCzkKwh: number | null };
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function modeledHdoDefinition(value: unknown): HdoSensitivityDefinition | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prices = value as Record<string, unknown>;
  const distributionVtCzkKwh = finite(prices.distributionVtCzkKwh);
  const distributionNtCzkKwh = finite(prices.distributionNtCzkKwh);
  const commodityBuyVtCzkKwh = finite(prices.commodityBuyVtCzkKwh);
  const commodityBuyNtCzkKwh = finite(prices.commodityBuyNtCzkKwh);
  const commoditySellCzkKwh = finite(prices.commoditySellCzkKwh);
  if (
    distributionVtCzkKwh == null ||
    distributionNtCzkKwh == null ||
    commodityBuyVtCzkKwh == null ||
    commodityBuyNtCzkKwh == null ||
    commoditySellCzkKwh == null
  ) return null;
  return {
    distributionVtCzkKwh,
    distributionNtCzkKwh,
    buy: { mode: "FIX", vtCzkKwh: commodityBuyVtCzkKwh, ntCzkKwh: commodityBuyNtCzkKwh },
    sell: { mode: "FIX", vtCzkKwh: commoditySellCzkKwh, ntCzkKwh: commoditySellCzkKwh },
  };
}

function fixedPrice(direction: HdoSensitivityDefinition["buy"], lowTariff: boolean, fallback: number) {
  if (direction.mode !== "FIX") return fallback;
  const value = lowTariff ? direction.ntCzkKwh ?? direction.vtCzkKwh : direction.vtCzkKwh;
  if (value == null || !Number.isFinite(value)) throw new Error("ANALYSIS_HDO_SENSITIVITY_PRICE_MISSING");
  return value;
}

export function applyHdoExtreme(
  points: HdoSensitivityPricePoint[],
  definition: HdoSensitivityDefinition,
  lowTariff: boolean,
): AnalysisDispatchPoint[] {
  const distribution = lowTariff ? definition.distributionNtCzkKwh : definition.distributionVtCzkKwh;
  return points.map((point) => {
    const commodityBuy = fixedPrice(definition.buy, lowTariff, point.commodityBuyCzkKwh);
    const commoditySell = fixedPrice(definition.sell, lowTariff, point.commoditySellCzkKwh);
    return {
      startAt: point.startAt,
      endAt: point.endAt,
      productionKwh: point.productionKwh,
      consumptionKwh: point.consumptionKwh,
      totalBuyCzkKwh: commodityBuy + distribution + point.otherRegulatedCzkKwh,
      totalSellCzkKwh: commoditySell,
    };
  });
}
