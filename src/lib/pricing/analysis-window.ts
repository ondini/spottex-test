import "server-only";

import { prisma } from "@/lib/prisma";

export type AnalysisWindow = { from: Date; to: Date };
export type MarketBounds = { validFrom: Date; validTo: Date } | null;

// Every tariff in one analysis is priced over the same period, and spot
// tariffs can only be priced where the OTE series exists. Measurements often
// start before the market data does; clamping the window to the series keeps
// FIX and SPOT comparable instead of dropping every SPOT curve with
// PRICE_CURVE_MARKET_SERIES_MISSING.
export function clampAnalysisWindow(window: AnalysisWindow, market: MarketBounds) {
  if (!market) {
    return { from: window.from, to: window.to, clamped: false, empty: window.from >= window.to };
  }
  const from = market.validFrom > window.from ? market.validFrom : window.from;
  const to = market.validTo < window.to ? market.validTo : window.to;
  return {
    from,
    to,
    clamped: from > window.from || to < window.to,
    empty: from >= to,
  };
}

export function latestPublishedMarketSeries() {
  return prisma.marketPriceSeries.findFirst({
    where: { market: "OTE_DAY_AHEAD", status: "PUBLISHED" },
    orderBy: { validTo: "desc" },
  });
}
