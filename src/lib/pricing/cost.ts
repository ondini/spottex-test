export type CostPricePoint = {
  startAt: Date;
  endAt: Date;
  commodityBuyCzkKwh: number;
  commoditySellCzkKwh: number;
  distributionCzkKwh: number;
  otherRegulatedCzkKwh: number;
  totalBuyCzkKwh: number;
  totalSellCzkKwh: number;
};

export type GridFlowPoint = {
  startAt: Date;
  importKwh: number;
  exportKwh: number;
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function evaluateEnergyCost(input: {
  flows: GridFlowPoint[];
  prices: CostPricePoint[];
  monthlyFixedCzk: number;
  periodFrom: Date;
  periodTo: Date;
}) {
  const prices = new Map(input.prices.map((point) => [point.startAt.getTime(), point]));
  let commodityBuyCzk = 0;
  let distributionCzk = 0;
  let regulatedCzk = 0;
  let exportRevenueCzk = 0;
  let importedKwh = 0;
  let exportedKwh = 0;
  for (const flow of input.flows) {
    if (!Number.isFinite(flow.importKwh) || !Number.isFinite(flow.exportKwh) || flow.importKwh < 0 || flow.exportKwh < 0) {
      throw new Error("ENERGY_COST_INVALID_FLOW");
    }
    const price = prices.get(flow.startAt.getTime());
    if (!price) throw new Error("ENERGY_COST_MISSING_PRICE");
    importedKwh += flow.importKwh;
    exportedKwh += flow.exportKwh;
    commodityBuyCzk += flow.importKwh * price.commodityBuyCzkKwh;
    distributionCzk += flow.importKwh * price.distributionCzkKwh;
    regulatedCzk += flow.importKwh * price.otherRegulatedCzkKwh;
    exportRevenueCzk += flow.exportKwh * price.totalSellCzkKwh;
  }
  const periodDays = (input.periodTo.getTime() - input.periodFrom.getTime()) / 86_400_000;
  if (!Number.isFinite(periodDays) || periodDays <= 0) throw new Error("ENERGY_COST_INVALID_PERIOD");
  const fixedCzk = input.monthlyFixedCzk * 12 * periodDays / 365;
  const importCostCzk = commodityBuyCzk + distributionCzk + regulatedCzk;
  return {
    importedKwh: roundMoney(importedKwh),
    exportedKwh: roundMoney(exportedKwh),
    commodityBuyCzk: roundMoney(commodityBuyCzk),
    distributionCzk: roundMoney(distributionCzk),
    regulatedCzk: roundMoney(regulatedCzk),
    fixedCzk: roundMoney(fixedCzk),
    exportRevenueCzk: roundMoney(exportRevenueCzk),
    importCostCzk: roundMoney(importCostCzk),
    totalCzk: roundMoney(importCostCzk + fixedCzk - exportRevenueCzk),
  };
}
