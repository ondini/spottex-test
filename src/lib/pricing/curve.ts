export type PricingMode = "FIX" | "SPOT" | "TIME_CURVE";

export type TimeValue = {
  startAt: Date;
  endAt: Date;
  value: number;
};

export type HdoValue = {
  startAt: Date;
  endAt: Date;
  lowTariff: boolean;
};

export type ProductCurveInput = {
  buyMode: PricingMode;
  sellMode: PricingMode;
  fixedBuyVtCzkKwh?: number | null;
  fixedBuyNtCzkKwh?: number | null;
  fixedSellVtCzkKwh?: number | null;
  fixedSellNtCzkKwh?: number | null;
  spotBuyFeeCzkKwh?: number | null;
  spotSellFeeCzkKwh?: number | null;
  monthlyFeeCzk: number;
  customBuyCurve?: TimeValue[];
  customSellCurve?: TimeValue[];
};

export type DistributionCurveInput = {
  distributionVtCzkKwh: number;
  distributionNtCzkKwh: number;
  systemServicesCzkKwh: number;
  electricityTaxCzkKwh: number;
  pozeCzkKwh: number;
  monthlyMeterFeeCzk: number;
  monthlyBreakerFeeCzk: number;
};

export type GeneratedPricePoint = {
  startAt: Date;
  endAt: Date;
  lowTariff: boolean;
  commodityBuyCzkKwh: number;
  commoditySellCzkKwh: number;
  distributionCzkKwh: number;
  otherRegulatedCzkKwh: number;
  totalBuyCzkKwh: number;
  totalSellCzkKwh: number;
};

export type HdoFallback = "ALL_VT" | "NIGHT_22_05";

function roundPrice(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function assertFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`PRICE_CURVE_INVALID_${label}`);
  return value;
}

function containing<T extends { startAt: Date; endAt: Date }>(items: T[], at: Date): T | null {
  const timestamp = at.getTime();
  return items.find((item) => item.startAt.getTime() <= timestamp && item.endAt.getTime() > timestamp) ?? null;
}

export function isConservativeNightLowTariff(at: Date, timezone = "Europe/Prague"): boolean {
  const hourPart = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" })
    .formatToParts(at)
    .find((part) => part.type === "hour")?.value;
  const hour = Number(hourPart);
  if (!Number.isInteger(hour)) throw new Error("PRICE_CURVE_INVALID_TIMEZONE");
  return hour >= 22 || hour < 5;
}

function fixedPrice(input: ProductCurveInput, direction: "BUY" | "SELL", lowTariff: boolean): number {
  const vt = direction === "BUY" ? input.fixedBuyVtCzkKwh : input.fixedSellVtCzkKwh;
  const nt = direction === "BUY" ? input.fixedBuyNtCzkKwh : input.fixedSellNtCzkKwh;
  const price = lowTariff ? nt ?? vt : vt;
  if (price == null) throw new Error(`PRICE_CURVE_MISSING_FIXED_${direction}`);
  return assertFinite(price, `FIXED_${direction}`);
}

function commodityPrice(input: {
  at: Date;
  lowTariff: boolean;
  direction: "BUY" | "SELL";
  product: ProductCurveInput;
  marketPricesCzkMwh: TimeValue[];
}): number {
  const { product, direction } = input;
  const mode = direction === "BUY" ? product.buyMode : product.sellMode;
  if (mode === "FIX") return fixedPrice(product, direction, input.lowTariff);
  if (mode === "SPOT") {
    const market = containing(input.marketPricesCzkMwh, input.at);
    if (!market) throw new Error("PRICE_CURVE_MISSING_MARKET_POINT");
    const fee = direction === "BUY" ? product.spotBuyFeeCzkKwh ?? 0 : product.spotSellFeeCzkKwh ?? 0;
    // A buy fee increases customer cost. A sell fee reduces the payout.
    return assertFinite(market.value / 1000 + (direction === "BUY" ? fee : -fee), `SPOT_${direction}`);
  }
  const curve = direction === "BUY" ? product.customBuyCurve : product.customSellCurve;
  const point = containing(curve ?? [], input.at);
  if (!point) throw new Error(`PRICE_CURVE_MISSING_CUSTOM_${direction}`);
  return assertFinite(point.value, `CUSTOM_${direction}`);
}

export function generatePriceCurve(input: {
  validFrom: Date;
  validTo: Date;
  resolutionMinutes: 15 | 60;
  product: ProductCurveInput;
  distribution: DistributionCurveInput;
  hdo: HdoValue[];
  hdoFallback?: HdoFallback;
  timezone?: string;
  marketPricesCzkMwh?: TimeValue[];
}) {
  const from = input.validFrom.getTime();
  const to = input.validTo.getTime();
  const stepMs = input.resolutionMinutes * 60_000;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || (to - from) % stepMs !== 0) {
    throw new Error("PRICE_CURVE_INVALID_WINDOW");
  }
  const otherRegulated = assertFinite(
    input.distribution.systemServicesCzkKwh
      + input.distribution.electricityTaxCzkKwh
      + input.distribution.pozeCzkKwh,
    "REGULATED",
  );
  const marketPricesCzkMwh = input.marketPricesCzkMwh ?? [];
  const points: GeneratedPricePoint[] = [];
  for (let timestamp = from; timestamp < to; timestamp += stepMs) {
    const startAt = new Date(timestamp);
    const hdo = containing(input.hdo, startAt);
    const lowTariff = hdo?.lowTariff
      ?? (input.hdo.length === 0 && input.hdoFallback === "NIGHT_22_05"
        ? isConservativeNightLowTariff(startAt, input.timezone)
        : false);
    const commodityBuy = commodityPrice({
      at: startAt,
      lowTariff,
      direction: "BUY",
      product: input.product,
      marketPricesCzkMwh,
    });
    const commoditySell = commodityPrice({
      at: startAt,
      lowTariff,
      direction: "SELL",
      product: input.product,
      marketPricesCzkMwh,
    });
    const distribution = lowTariff
      ? input.distribution.distributionNtCzkKwh
      : input.distribution.distributionVtCzkKwh;
    points.push({
      startAt,
      endAt: new Date(timestamp + stepMs),
      lowTariff,
      commodityBuyCzkKwh: roundPrice(commodityBuy),
      commoditySellCzkKwh: roundPrice(commoditySell),
      distributionCzkKwh: roundPrice(distribution),
      otherRegulatedCzkKwh: roundPrice(otherRegulated),
      totalBuyCzkKwh: roundPrice(commodityBuy + distribution + otherRegulated),
      totalSellCzkKwh: roundPrice(commoditySell),
    });
  }
  return {
    points,
    hdoSource: input.hdo.length > 0 ? "CALENDAR" as const : input.hdoFallback ?? "ALL_VT",
    monthlyFixedCzk: roundPrice(
      input.product.monthlyFeeCzk
        + input.distribution.monthlyMeterFeeCzk
        + input.distribution.monthlyBreakerFeeCzk,
    ),
  };
}
