import "server-only";

import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getEnergyDataQuality } from "@/lib/energy/data-quality";

import { generatePriceCurve, type HdoValue, type PricingMode } from "./curve";
import { compileTimeRules } from "./time-rules";

function number(value: Prisma.Decimal | number | null | undefined, fallback = 0) {
  return value == null ? fallback : Number(value);
}

function object(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

type CatalogProductCandidate = Prisma.EnergyProductVersionGetPayload<{
  include: { product: { include: { supplier: true } } };
}>;

function productDirection(product: CatalogProductCandidate) {
  const direction = object(product.product.metadata).direction;
  return direction === "BUY" || direction === "SELL" ? direction : null;
}

function productSupportsDistribution(
  product: CatalogProductCandidate,
  distributionCode: string,
) {
  const configured = object(product.product.metadata).distributionCodes;
  if (!Array.isArray(configured) || configured.length === 0) return true;
  return configured.some(
    (value) =>
      typeof value === "string" &&
      value.toUpperCase() === distributionCode.toUpperCase(),
  );
}

function lowTariffShare(distributionCode: string) {
  return tariffDailyLowHours(distributionCode) / 24;
}

function buySelectionScore(
  product: CatalogProductCandidate,
  distributionCode: string,
  annualImportKwh: number,
) {
  const lowShare = lowTariffShare(distributionCode);
  const unit =
    product.buyMode === "SPOT"
      ? number(product.spotBuyFeeCzkKwh)
      : number(product.fixedBuyVtCzkKwh) * (1 - lowShare) +
        number(
          product.fixedBuyNtCzkKwh,
          number(product.fixedBuyVtCzkKwh),
        ) *
          lowShare;
  return number(product.monthlyFeeCzk) * 12 + unit * annualImportKwh;
}

function sellSelectionScore(
  product: CatalogProductCandidate,
  annualExportKwh: number,
) {
  const unit =
    product.sellMode === "SPOT"
      ? number(product.spotSellFeeCzkKwh)
      : -(
          number(product.fixedSellVtCzkKwh) +
          number(
            product.fixedSellNtCzkKwh,
            number(product.fixedSellVtCzkKwh),
          )
        ) / 2;
  return number(product.monthlyFeeCzk) * 12 + unit * annualExportKwh;
}

export function breakerMonthlyFee(breakerFees: Prisma.JsonValue, phases: number, amperes: number): number {
  const table = object(breakerFees);
  const direct = table[`${phases}x${amperes}`] ?? table[`${phases}×${amperes}`];
  if (typeof direct === "number" && Number.isFinite(direct) && direct >= 0) return direct;
  const phase = object((table[String(phases)] ?? null) as Prisma.JsonValue);
  const nested = phase[String(amperes)];
  if (typeof nested === "number" && Number.isFinite(nested) && nested >= 0) return nested;
  throw new Error("PRICE_CURVE_BREAKER_FEE_MISSING");
}

export function tariffDailyLowHours(code: string | null | undefined) {
  const normalized = code?.trim().toUpperCase();
  if (["D25D", "D26D", "D27D"].includes(normalized ?? "")) return 8;
  if (normalized === "D35D") return 16;
  if (["D45D", "D56D", "D57D"].includes(normalized ?? "")) return 20;
  return 0;
}

function modelHdo(
  from: Date,
  to: Date,
  timezone: string,
  dailyLowHours: number,
): HdoValue[] {
  if (dailyLowHours <= 0) return [];
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const low: HdoValue[] = [];
  const lowStartHour = dailyLowHours >= 16 ? 21 : 22;
  for (let timestamp = from.getTime(); timestamp < to.getTime(); timestamp += 15 * 60_000) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
    const hour = Number(parts.hour);
    const lowEndHour = (lowStartHour + dailyLowHours) % 24;
    const isLow = lowStartHour < lowEndHour
      ? hour >= lowStartHour && hour < lowEndHour
      : hour >= lowStartHour || hour < lowEndHour;
    if (!isLow) continue;
    const previous = low.at(-1);
    if (previous?.endAt.getTime() === timestamp) previous.endAt = new Date(timestamp + 15 * 60_000);
    else low.push({ startAt: new Date(timestamp), endAt: new Date(timestamp + 15 * 60_000), lowTariff: true });
  }
  return low;
}

const MODELED_STANDARD_CZ_2026 = {
  purpose: "MODELED_STANDARD_CZ_2026",
  algorithmVersion: "SPOTTEX_MODELED_STANDARD_CZ_2026_V4_D02D_FALLBACK",
  label: "Orientační český tarif 2026 · D02d · 3×25 A",
  pricingAsOf: "2026-07-01",
  sourceUrl:
    "https://www.pre.cz/cs/linky/dokumenty-ke-stazeni/cenik/elektrina/pre/moo/pre-proud-favorit-2/",
  sourceDocument: "PRE PROUD FAVORIT 2 07/2026",
  assumptions: {
    commodityBuyVtCzkKwh: 3.9325,
    commodityBuyNtCzkKwh: 3.9325,
    commoditySellCzkKwh: 0,
    distributionVtCzkKwh: 1.835,
    distributionNtCzkKwh: 1.835,
    systemServicesCzkKwh: 0.19873,
    electricityTaxCzkKwh: 0.03424,
    pozeCzkKwh: 0,
    monthlySupplierFeeCzk: 156.09,
    monthlyBreakerFeeCzk: 262.57,
    monthlyInfrastructureFeeCzk: 15.57,
  },
} as const;

function validateHdoIntervals(items: HdoValue[], from: Date, to: Date) {
  const sorted = [...items].sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
  let previousEnd = from.getTime();
  for (const item of sorted) {
    const start = item.startAt.getTime();
    const end = item.endAt.getTime();
    if (start < from.getTime() || end > to.getTime() || end <= start || start % 900_000 !== 0 || end % 900_000 !== 0 || start < previousEnd) throw new Error("PRICE_CURVE_HDO_INVALID");
    previousEnd = end;
  }
}

export async function materializeCatalogPriceCurve(input: {
  actorUserId: number;
  energySiteId: number;
  buyProductVersionId: number;
  sellProductVersionId: number;
  distributionVersionId: number;
  marketPriceSeriesId?: string;
  validFrom: Date;
  validTo: Date;
  purpose: string;
  pricingAsOf?: Date;
}) {
  const [site, buyProduct, sellProduct, distribution] = await Promise.all([
    prisma.energySite.findUnique({ where: { id: input.energySiteId }, include: { technicalProfile: true, hdoCalendars: { where: { exact: true, validFrom: { lte: input.validFrom }, validTo: { gte: input.validTo } }, include: { intervals: { orderBy: { startAt: "asc" } } }, orderBy: { createdAt: "desc" }, take: 1 } } }),
    prisma.energyProductVersion.findUnique({ where: { id: input.buyProductVersionId }, include: { product: true } }),
    prisma.energyProductVersion.findUnique({ where: { id: input.sellProductVersionId }, include: { product: true } }),
    prisma.distributionTariffVersion.findUnique({ where: { id: input.distributionVersionId }, include: { distributionTariff: true } }),
  ]);
  if (!site?.technicalProfile) throw new Error("PRICE_CURVE_SITE_PROFILE_MISSING");
  if (!buyProduct || buyProduct.status !== "PUBLISHED" || !buyProduct.product.active) throw new Error("PRICE_CURVE_BUY_PRODUCT_NOT_PUBLISHED");
  if (!sellProduct || sellProduct.status !== "PUBLISHED" || !sellProduct.product.active) throw new Error("PRICE_CURVE_SELL_PRODUCT_NOT_PUBLISHED");
  if (!distribution || distribution.status !== "PUBLISHED" || !distribution.distributionTariff.active) throw new Error("PRICE_CURVE_DISTRIBUTION_NOT_PUBLISHED");
  if (!buyProduct.vatIncluded || !sellProduct.vatIncluded || !distribution.vatIncluded) throw new Error("PRICE_CURVE_VAT_NOT_INCLUDED");
  const pricingAsOf = input.pricingAsOf ?? new Date();
  if (buyProduct.validFrom > pricingAsOf || (buyProduct.validTo && buyProduct.validTo <= pricingAsOf)) throw new Error("PRICE_CURVE_BUY_PRODUCT_NOT_CURRENT");
  if (sellProduct.validFrom > pricingAsOf || (sellProduct.validTo && sellProduct.validTo <= pricingAsOf)) throw new Error("PRICE_CURVE_SELL_PRODUCT_NOT_CURRENT");
  if (distribution.validFrom > pricingAsOf || (distribution.validTo && distribution.validTo <= pricingAsOf)) throw new Error("PRICE_CURVE_DISTRIBUTION_NOT_CURRENT");
  const profile = site.technicalProfile;
  if (profile.phases == null || profile.mainFuseA == null) throw new Error("PRICE_CURVE_BREAKER_MISSING");

  const needsMarket =
    buyProduct.buyMode === "SPOT" || sellProduct.sellMode === "SPOT";
  const market = needsMarket && input.marketPriceSeriesId ? await prisma.marketPriceSeries.findUnique({ where: { id: input.marketPriceSeriesId }, include: { points: { where: { startAt: { lte: input.validTo }, endAt: { gte: input.validFrom } }, orderBy: { startAt: "asc" } } } }) : null;
  if (needsMarket && (!market || market.status !== "PUBLISHED" || market.validFrom > input.validFrom || market.validTo < input.validTo)) throw new Error("PRICE_CURVE_MARKET_SERIES_MISSING");

  const exactHdo = site.hdoCalendars[0] ?? null;
  const modeledLowHours = tariffDailyLowHours(
    distribution.distributionTariff.code,
  );
  const hdo = exactHdo
    ? exactHdo.intervals.flatMap((item) => {
      const startAt = new Date(Math.max(item.startAt.getTime(), input.validFrom.getTime()));
      const endAt = new Date(Math.min(item.endAt.getTime(), input.validTo.getTime()));
      return endAt > startAt ? [{ startAt, endAt, lowTariff: item.lowTariff }] : [];
    })
    : modelHdo(
        input.validFrom,
        input.validTo,
        site.timezone,
        modeledLowHours,
      );
  validateHdoIntervals(hdo, input.validFrom, input.validTo);
  const generated = generatePriceCurve({
    validFrom: input.validFrom,
    validTo: input.validTo,
    resolutionMinutes: 15,
    timezone: site.timezone,
    product: {
      buyMode: buyProduct.buyMode as PricingMode,
      sellMode: sellProduct.sellMode as PricingMode,
      fixedBuyVtCzkKwh: number(buyProduct.fixedBuyVtCzkKwh),
      fixedBuyNtCzkKwh: buyProduct.fixedBuyNtCzkKwh == null ? null : number(buyProduct.fixedBuyNtCzkKwh),
      fixedSellVtCzkKwh: number(sellProduct.fixedSellVtCzkKwh),
      fixedSellNtCzkKwh: sellProduct.fixedSellNtCzkKwh == null ? null : number(sellProduct.fixedSellNtCzkKwh),
      spotBuyFeeCzkKwh: number(buyProduct.spotBuyFeeCzkKwh),
      spotSellFeeCzkKwh: number(sellProduct.spotSellFeeCzkKwh),
      monthlyFeeCzk:
        number(buyProduct.monthlyFeeCzk) +
        (buyProduct.id === sellProduct.id
          ? 0
          : number(sellProduct.monthlyFeeCzk)),
      customBuyCurve: buyProduct.buyMode === "TIME_CURVE" ? compileTimeRules({ formula: buyProduct.formula, direction: "BUY", validFrom: input.validFrom, validTo: input.validTo, resolutionMinutes: 15, timezone: site.timezone }) : undefined,
      customSellCurve: sellProduct.sellMode === "TIME_CURVE" ? compileTimeRules({ formula: sellProduct.formula, direction: "SELL", validFrom: input.validFrom, validTo: input.validTo, resolutionMinutes: 15, timezone: site.timezone }) : undefined,
    },
    distribution: {
      distributionVtCzkKwh: number(distribution.distributionVtCzkKwh),
      distributionNtCzkKwh: number(distribution.distributionNtCzkKwh),
      systemServicesCzkKwh: number(distribution.systemServicesCzkKwh),
      electricityTaxCzkKwh: number(distribution.electricityTaxCzkKwh),
      pozeCzkKwh: number(distribution.pozeCzkKwh),
      monthlyMeterFeeCzk: number(distribution.monthlyMeterFeeCzk),
      monthlyBreakerFeeCzk: breakerMonthlyFee(distribution.breakerFees, profile.phases, profile.mainFuseA),
    },
    hdo,
    marketPricesCzkMwh: market?.points.map((point) => ({ startAt: point.startAt, endAt: point.endAt, value: Number(point.priceCzkMwh) })),
  });
  const hdoMode = exactHdo
    ? `EXACT:${exactHdo.id}`
    : modeledLowHours > 0
      ? `MODEL:DAILY_${modeledLowHours}H`
      : "NONE:SINGLE_TARIFF";
  const fingerprint = createHash("sha256").update(JSON.stringify({ version: 3, siteId: site.id, buyProductVersionId: buyProduct.id, sellProductVersionId: sellProduct.id, distributionVersionId: distribution.id, marketSeriesId: market?.id ?? null, from: input.validFrom.toISOString(), to: input.validTo.toISOString(), hdoMode, generated })).digest("hex");
  const existing = await prisma.energyPriceCurve.findUnique({ where: { fingerprint } });
  if (existing) return existing;
  return prisma.$transaction(async (tx) => {
    const curve = await tx.energyPriceCurve.create({ data: { energySiteId: site.id, buyProductVersionId: buyProduct.id, sellProductVersionId: sellProduct.id, distributionVersionId: distribution.id, marketPriceSeriesId: market?.id, hdoCalendarId: exactHdo?.id, fingerprint, purpose: input.purpose, algorithmVersion: "SPOTTEX_PRICE_CURVE_V2_SPLIT_BUY_SELL", timezone: site.timezone, resolutionMinutes: 15, validFrom: input.validFrom, validTo: input.validTo, monthlyFixedCzk: generated.monthlyFixedCzk, status: "READY", assumptions: { hdoMode, exactHdo: Boolean(exactHdo), breaker: `${profile.phases}x${profile.mainFuseA}`, vatIncluded: buyProduct.vatIncluded && sellProduct.vatIncluded && distribution.vatIncluded } } });
    await tx.energyPriceCurvePoint.createMany({ data: generated.points.map((point) => ({ curveId: curve.id, ...point })) });
    await tx.auditLog.create({ data: { actorUserId: input.actorUserId, action: "ENERGY_PRICE_CURVE_MATERIALIZED", entityType: "EnergyPriceCurve", entityId: curve.id, metadata: { buyProductVersionId: buyProduct.id, sellProductVersionId: sellProduct.id, distributionVersionId: distribution.id, marketSeriesId: market?.id ?? null, hdoMode, pointCount: generated.points.length } } });
    return curve;
  }, { timeout: 60_000 });
}

export async function materializeCurrentBaselinePriceCurve(input: {
  actorUserId: number;
  energySiteId: number;
  validFrom: Date;
  validTo: Date;
  pricingAsOf?: Date;
}) {
  const pricingAsOf = input.pricingAsOf ?? new Date();
  const site = await prisma.energySite.findUnique({
    where: { id: input.energySiteId },
    include: {
      technicalProfile: true,
      hdoCalendars: { where: { exact: true, validFrom: { lte: input.validFrom }, validTo: { gte: input.validTo } }, include: { intervals: { orderBy: { startAt: "asc" } } }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  const profile = site?.technicalProfile;
  if (!site || !profile) throw new Error("PRICE_CURVE_SITE_PROFILE_MISSING");
  if (profile.phases == null || profile.mainFuseA == null) throw new Error("PRICE_CURVE_BREAKER_MISSING");
  if (!profile.distributionTariffCode) throw new Error("PRICE_CURVE_CURRENT_DISTRIBUTION_MISSING");
  if (!profile.buyPricingMode || !profile.sellPricingMode) throw new Error("PRICE_CURVE_CURRENT_PRODUCT_MISSING");
  if (profile.buyPricingMode === "OTHER" || profile.sellPricingMode === "OTHER") throw new Error("PRICE_CURVE_CURRENT_PRODUCT_UNSUPPORTED");
  if (profile.buyPricingMode === "FIX" && profile.fixedBuyPriceCzkKwh == null) throw new Error("PRICE_CURVE_CURRENT_BUY_PRICE_MISSING");
  if (profile.sellPricingMode === "FIX" && profile.fixedSellPriceCzkKwh == null) throw new Error("PRICE_CURVE_CURRENT_SELL_PRICE_MISSING");

  const candidates = await prisma.distributionTariffVersion.findMany({
    where: {
      status: "PUBLISHED",
      validFrom: { lte: pricingAsOf },
      OR: [{ validTo: null }, { validTo: { gt: pricingAsOf } }],
      distributionTariff: { active: true, customerSegment: "HOUSEHOLD", code: { equals: profile.distributionTariffCode, mode: "insensitive" } },
    },
    include: { distributionTariff: { include: { distributor: true } } },
    orderBy: { validFrom: "desc" },
  });
  const distribution = profile.distributorCode
    ? candidates.find((item) => item.distributionTariff.distributor.code.toUpperCase() === profile.distributorCode!.toUpperCase())
    : candidates.length === 1 ? candidates[0] : null;
  if (!distribution) throw new Error(candidates.length > 1 ? "PRICE_CURVE_CURRENT_DISTRIBUTION_AMBIGUOUS" : "PRICE_CURVE_CURRENT_DISTRIBUTION_NOT_PUBLISHED");
  if (!distribution.vatIncluded) throw new Error("PRICE_CURVE_VAT_NOT_INCLUDED");

  const needsMarket = profile.buyPricingMode === "SPOT" || profile.sellPricingMode === "SPOT";
  const market = needsMarket ? await prisma.marketPriceSeries.findFirst({
    where: { status: "PUBLISHED", validFrom: { lte: input.validFrom }, validTo: { gte: input.validTo } },
    orderBy: { validFrom: "desc" },
    include: { points: { where: { startAt: { lte: input.validTo }, endAt: { gte: input.validFrom } }, orderBy: { startAt: "asc" } } },
  }) : null;
  if (needsMarket && !market) throw new Error("PRICE_CURVE_MARKET_SERIES_MISSING");

  const exactHdo = site.hdoCalendars[0] ?? null;
  const modeledLowHours = tariffDailyLowHours(
    distribution.distributionTariff.code,
  );
  const hdo = exactHdo
    ? exactHdo.intervals.flatMap((item) => {
      const startAt = new Date(Math.max(item.startAt.getTime(), input.validFrom.getTime()));
      const endAt = new Date(Math.min(item.endAt.getTime(), input.validTo.getTime()));
      return endAt > startAt ? [{ startAt, endAt, lowTariff: item.lowTariff }] : [];
    })
    : modelHdo(
        input.validFrom,
        input.validTo,
        site.timezone,
        modeledLowHours,
      );
  validateHdoIntervals(hdo, input.validFrom, input.validTo);
  const generated = generatePriceCurve({
    validFrom: input.validFrom,
    validTo: input.validTo,
    resolutionMinutes: 15,
    timezone: site.timezone,
    product: {
      buyMode: profile.buyPricingMode as PricingMode,
      sellMode: profile.sellPricingMode as PricingMode,
      fixedBuyVtCzkKwh: profile.fixedBuyPriceCzkKwh,
      fixedBuyNtCzkKwh: profile.fixedBuyPriceCzkKwh,
      fixedSellVtCzkKwh: profile.fixedSellPriceCzkKwh,
      fixedSellNtCzkKwh: profile.fixedSellPriceCzkKwh,
      spotBuyFeeCzkKwh: profile.spotBuyFeeCzkKwh,
      spotSellFeeCzkKwh: profile.spotSellFeeCzkKwh,
      monthlyFeeCzk: profile.monthlySupplierFeeCzk ?? 0,
    },
    distribution: {
      distributionVtCzkKwh: number(distribution.distributionVtCzkKwh),
      distributionNtCzkKwh: number(distribution.distributionNtCzkKwh),
      systemServicesCzkKwh: number(distribution.systemServicesCzkKwh),
      electricityTaxCzkKwh: number(distribution.electricityTaxCzkKwh),
      pozeCzkKwh: number(distribution.pozeCzkKwh),
      monthlyMeterFeeCzk: number(distribution.monthlyMeterFeeCzk),
      monthlyBreakerFeeCzk: breakerMonthlyFee(distribution.breakerFees, profile.phases, profile.mainFuseA),
    },
    hdo,
    marketPricesCzkMwh: market?.points.map((point) => ({ startAt: point.startAt, endAt: point.endAt, value: Number(point.priceCzkMwh) })),
  });
  const hdoMode = exactHdo
    ? `EXACT:${exactHdo.id}`
    : modeledLowHours > 0
      ? `MODEL:DAILY_${modeledLowHours}H`
      : "NONE:SINGLE_TARIFF";
  const priceInput = {
    supplier: profile.currentSupplierName,
    product: profile.currentProductName,
    buyMode: profile.buyPricingMode,
    sellMode: profile.sellPricingMode,
    fixedBuyPriceCzkKwh: profile.fixedBuyPriceCzkKwh,
    fixedSellPriceCzkKwh: profile.fixedSellPriceCzkKwh,
    spotBuyFeeCzkKwh: profile.spotBuyFeeCzkKwh,
    spotSellFeeCzkKwh: profile.spotSellFeeCzkKwh,
    monthlySupplierFeeCzk: profile.monthlySupplierFeeCzk,
  };
  const fingerprint = createHash("sha256").update(JSON.stringify({ version: 1, purpose: "CURRENT_BASELINE", siteId: site.id, distributionVersionId: distribution.id, marketSeriesId: market?.id ?? null, from: input.validFrom.toISOString(), to: input.validTo.toISOString(), hdoMode, priceInput, generated })).digest("hex");
  const existing = await prisma.energyPriceCurve.findUnique({ where: { fingerprint } });
  if (existing) return existing;
  return prisma.$transaction(async (tx) => {
    await tx.energyPriceCurve.updateMany({ where: { energySiteId: site.id, purpose: "CURRENT_BASELINE", status: { in: ["DRAFT", "READY"] } }, data: { status: "SUPERSEDED" } });
    const curve = await tx.energyPriceCurve.create({ data: { energySiteId: site.id, distributionVersionId: distribution.id, marketPriceSeriesId: market?.id, hdoCalendarId: exactHdo?.id, fingerprint, purpose: "CURRENT_BASELINE", algorithmVersion: "SPOTTEX_CURRENT_PRICE_CURVE_V1", timezone: site.timezone, resolutionMinutes: 15, validFrom: input.validFrom, validTo: input.validTo, monthlyFixedCzk: generated.monthlyFixedCzk, status: "READY", assumptions: { hdoMode, exactHdo: Boolean(exactHdo), breaker: `${profile.phases}x${profile.mainFuseA}`, vatIncluded: true, pricingAsOf: pricingAsOf.toISOString(), priceInput } } });
    await tx.energyPriceCurvePoint.createMany({ data: generated.points.map((point) => ({ curveId: curve.id, ...point })) });
    await tx.auditLog.create({ data: { actorUserId: input.actorUserId, action: "ENERGY_CURRENT_BASELINE_MATERIALIZED", entityType: "EnergyPriceCurve", entityId: curve.id, metadata: { distributionVersionId: distribution.id, marketSeriesId: market?.id ?? null, hdoMode, pointCount: generated.points.length, priceInput } } });
    return curve;
  }, { timeout: 60_000 });
}

/**
 * Creates a transparent, deliberately conservative first-run curve when the
 * site's exact contract and the reviewed catalog are not available yet.
 *
 * Values are VAT-inclusive and come from one complete current Czech public
 * price list. Export revenue is intentionally zero, so the estimate does not
 * overstate savings. This is an analysis fallback, never a claim about the
 * customer's actual contract or distributor.
 */
export async function materializeModeledStandardPriceCurve(input: {
  actorUserId: number;
  energySiteId: number;
  validFrom: Date;
  validTo: Date;
}) {
  const site = await prisma.energySite.findUnique({
    where: { id: input.energySiteId },
    include: { technicalProfile: true },
  });
  if (!site?.technicalProfile)
    throw new Error("PRICE_CURVE_SITE_PROFILE_MISSING");

  // D02d is a neutral single-tariff fallback. A heating tariff and modeled HDO
  // must never be assigned unless the customer actually confirms eligibility.
  const hdo: HdoValue[] = [];
  validateHdoIntervals(hdo, input.validFrom, input.validTo);

  const prices = MODELED_STANDARD_CZ_2026.assumptions;
  const generated = generatePriceCurve({
    validFrom: input.validFrom,
    validTo: input.validTo,
    resolutionMinutes: 15,
    timezone: site.timezone,
    product: {
      buyMode: "FIX",
      sellMode: "FIX",
      fixedBuyVtCzkKwh: prices.commodityBuyVtCzkKwh,
      fixedBuyNtCzkKwh: prices.commodityBuyNtCzkKwh,
      fixedSellVtCzkKwh: prices.commoditySellCzkKwh,
      fixedSellNtCzkKwh: prices.commoditySellCzkKwh,
      monthlyFeeCzk: prices.monthlySupplierFeeCzk,
    },
    distribution: {
      distributionVtCzkKwh: prices.distributionVtCzkKwh,
      distributionNtCzkKwh: prices.distributionNtCzkKwh,
      systemServicesCzkKwh: prices.systemServicesCzkKwh,
      electricityTaxCzkKwh: prices.electricityTaxCzkKwh,
      pozeCzkKwh: prices.pozeCzkKwh,
      monthlyMeterFeeCzk: prices.monthlyInfrastructureFeeCzk,
      monthlyBreakerFeeCzk: prices.monthlyBreakerFeeCzk,
    },
    hdo,
  });
  const hdoMode = "NONE:SINGLE_TARIFF";
  const modelInput = {
    ...MODELED_STANDARD_CZ_2026,
    hdoMode,
    exactHdo: false,
    validFrom: input.validFrom.toISOString(),
    validTo: input.validTo.toISOString(),
  };
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        siteId: site.id,
        modelInput,
        generated,
      }),
    )
    .digest("hex");
  const existing = await prisma.energyPriceCurve.findUnique({
    where: { fingerprint },
  });
  if (existing) return existing;

  return prisma.$transaction(
    async (tx) => {
      await tx.energyPriceCurve.updateMany({
        where: {
          energySiteId: site.id,
          purpose: MODELED_STANDARD_CZ_2026.purpose,
          status: { in: ["DRAFT", "READY"] },
        },
        data: { status: "SUPERSEDED" },
      });
      const curve = await tx.energyPriceCurve.create({
        data: {
          energySiteId: site.id,
          fingerprint,
          purpose: MODELED_STANDARD_CZ_2026.purpose,
          algorithmVersion: MODELED_STANDARD_CZ_2026.algorithmVersion,
          timezone: site.timezone,
          resolutionMinutes: 15,
          validFrom: input.validFrom,
          validTo: input.validTo,
          monthlyFixedCzk: generated.monthlyFixedCzk,
          status: "READY",
          assumptions: {
            source: "MODELED_DEFAULT",
            analysisOnly: true,
            needsUserConfirmation: false,
            vatIncluded: true,
            confidence: "ORIENTATIONAL",
            label: MODELED_STANDARD_CZ_2026.label,
            pricingMode: "FIX",
            sellPricingMode: "FIX",
            distributionCode: "D02d",
            hdoMode,
            exactHdo: false,
            pricingAsOf: MODELED_STANDARD_CZ_2026.pricingAsOf,
            sourceUrl: MODELED_STANDARD_CZ_2026.sourceUrl,
            sourceDocument: MODELED_STANDARD_CZ_2026.sourceDocument,
            prices,
            limitations: [
              "Nejde o skutečný tarif zákazníka.",
              "Použitý neutrální jednotarifní model je PRE D02d, jistič 3×25 A.",
              "Výkup přetoků je konzervativně oceněn nulou.",
              "D02d nemá nízký tarif ani HDO.",
            ],
          },
        },
      });
      await tx.energyPriceCurvePoint.createMany({
        data: generated.points.map((point) => ({
          curveId: curve.id,
          ...point,
        })),
      });
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "ENERGY_MODELED_STANDARD_CURVE_MATERIALIZED",
          entityType: "EnergyPriceCurve",
          entityId: curve.id,
          metadata: {
            model: MODELED_STANDARD_CZ_2026.algorithmVersion,
            sourceUrl: MODELED_STANDARD_CZ_2026.sourceUrl,
            hdoMode,
            pointCount: generated.points.length,
          },
        },
      });
      return curve;
    },
    { timeout: 60_000 },
  );
}

export async function ensurePublishedCatalogCurvesForSite(userId: number, energySiteId: number) {
  const [site, quality] = await Promise.all([
    prisma.energySite.findFirst({ where: { id: energySiteId, userId }, include: { technicalProfile: true } }),
    getEnergyDataQuality(userId, energySiteId),
  ]);
  if (!site?.technicalProfile || !quality.from || !quality.to) return { created: 0, skipped: 0, errors: ["PRICE_CURVE_SITE_DATA_MISSING"] };
  const validFrom = new Date(quality.from);
  const dataValidTo = new Date(new Date(quality.to).getTime() + 15 * 60_000);
  const pricingAsOf = new Date();
  const confirmedDistributorCode = site.technicalProfile.distributorCode?.trim();
  const comparisonDistributorCode =
    confirmedDistributorCode ||
    process.env.ANALYSIS_REFERENCE_DISTRIBUTOR_CODE ||
    "CEZ_DISTRIBUCE";
  const [products, distributions, market] = await Promise.all([
    prisma.energyProductVersion.findMany({ where: { status: "PUBLISHED", validFrom: { lte: pricingAsOf }, OR: [{ validTo: null }, { validTo: { gt: pricingAsOf } }], product: { active: true, customerSegment: "HOUSEHOLD" } }, include: { product: { include: { supplier: true } } }, orderBy: [{ productId: "asc" }, { validFrom: "desc" }], distinct: ["productId"], take: 100 }),
    prisma.distributionTariffVersion.findMany({ where: { status: "PUBLISHED", validFrom: { lte: pricingAsOf }, OR: [{ validTo: null }, { validTo: { gt: pricingAsOf } }], distributionTariff: { active: true, customerSegment: "HOUSEHOLD", distributor: { code: comparisonDistributorCode } } }, include: { distributionTariff: true }, orderBy: [{ distributionTariffId: "asc" }, { validFrom: "desc" }], distinct: ["distributionTariffId"], take: 24 }),
    prisma.marketPriceSeries.findFirst({ where: { status: "PUBLISHED", validFrom: { lte: validFrom }, validTo: { gte: dataValidTo } }, orderBy: { validFrom: "desc" } }),
  ]);
  // Materialize through the end of the already published market series. Live
  // measurements advance every quarter-hour; ending curves exactly at the
  // newest measurement forced all tariff curves (and hundreds of thousands
  // of points) to be rebuilt on nearly every click.
  const validTo = market?.validTo ?? dataValidTo;
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];
  try {
    await materializeCurrentBaselinePriceCurve({ actorUserId: userId, energySiteId, validFrom, validTo, pricingAsOf });
    created += 1;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "PRICE_CURVE_CURRENT_BASELINE_FAILED");
  }
  try {
    // Always resolve the exact current fallback fingerprint. Merely finding an
    // older READY curve by purpose would keep a superseded tariff model (for
    // example the former D57d fallback) alive indefinitely.
    await materializeModeledStandardPriceCurve({
      actorUserId: userId,
      energySiteId,
      validFrom,
      validTo,
    });
    created += 1;
  } catch (error) {
    errors.push(
      error instanceof Error
        ? error.message
        : "PRICE_CURVE_MODELED_STANDARD_FAILED",
    );
  }
  const buyProducts = products.filter(
    (product) => productDirection(product) === "BUY",
  );
  const sellProducts = products.filter(
    (product) => productDirection(product) === "SELL",
  );
  const annualImportKwh = Math.max(
    500,
    quality.annualizedConsumptionKwh * 0.4,
  );
  const annualExportKwh = Math.max(
    500,
    quality.annualizedProductionKwh - quality.annualizedConsumptionKwh,
  );
  const combinations: Array<{
    buy: CatalogProductCandidate;
    sell: CatalogProductCandidate;
    distribution: (typeof distributions)[number];
    purpose: string;
  }> = [];

  for (const distribution of distributions) {
    const distributionCode = distribution.distributionTariff.code;
    const supportedBuy = buyProducts.filter((product) =>
      productSupportsDistribution(product, distributionCode),
    );
    const supportedSell = sellProducts.filter((product) =>
      productSupportsDistribution(product, distributionCode),
    );
    const bestBuy = (mode: "FIX" | "SPOT") =>
      supportedBuy
        .filter((product) => product.buyMode === mode)
        .sort(
          (left, right) =>
            buySelectionScore(left, distributionCode, annualImportKwh) -
            buySelectionScore(right, distributionCode, annualImportKwh),
        )[0];
    const bestSell = (mode: "FIX" | "SPOT") =>
      supportedSell
        .filter((product) => product.sellMode === mode)
        .sort(
          (left, right) =>
            sellSelectionScore(left, annualExportKwh) -
            sellSelectionScore(right, annualExportKwh),
        )[0];
    const fixedBuy = bestBuy("FIX");
    const spotBuy = bestBuy("SPOT");
    const fixedSell = bestSell("FIX");
    const spotSell = bestSell("SPOT");
    if (fixedBuy && fixedSell)
      combinations.push({
        buy: fixedBuy,
        sell: fixedSell,
        distribution,
        purpose: `CATALOG_BEST:FIX:FIX:${distribution.id}`,
      });
    if (fixedBuy && spotSell)
      combinations.push({
        buy: fixedBuy,
        sell: spotSell,
        distribution,
        purpose: `CATALOG_BEST:FIX:SPOT:${distribution.id}`,
      });
    if (spotBuy && spotSell)
      combinations.push({
        buy: spotBuy,
        sell: spotSell,
        distribution,
        purpose: `CATALOG_BEST:SPOT:SPOT:${distribution.id}`,
      });
  }

  const referenceBuy = buyProducts.find(
    (product) => object(product.product.metadata).referenceBaseline === true,
  );
  const referenceSell = sellProducts.find(
    (product) => object(product.product.metadata).referenceBaseline === true,
  );
  const referenceDistribution = distributions.find(
    (distribution) =>
      distribution.distributionTariff.code.toUpperCase() === "D01D",
  );
  if (referenceBuy && referenceSell && referenceDistribution) {
    combinations.push({
      buy: referenceBuy,
      sell: referenceSell,
      distribution: referenceDistribution,
      purpose: "REFERENCE_BASELINE:CEZ_D01D_NO_COMMITMENT",
    });
  }

  for (const combination of combinations) {
    if (created + skipped >= 100) {
      errors.push("PRICE_CURVE_COMBINATION_LIMIT");
      break;
    }
    try {
      const before = await prisma.energyPriceCurve.count({
        where: {
          energySiteId,
          buyProductVersionId: combination.buy.id,
          sellProductVersionId: combination.sell.id,
          distributionVersionId: combination.distribution.id,
          validFrom: { lte: validFrom },
          validTo: { gte: validTo },
          status: "READY",
        },
      });
      if (before) {
        skipped += 1;
        continue;
      }
      await materializeCatalogPriceCurve({
        actorUserId: userId,
        energySiteId,
        buyProductVersionId: combination.buy.id,
        sellProductVersionId: combination.sell.id,
        distributionVersionId: combination.distribution.id,
        marketPriceSeriesId: market?.id,
        validFrom,
        validTo,
        pricingAsOf,
        purpose: combination.purpose,
      });
      created += 1;
    } catch (error) {
      errors.push(
        error instanceof Error
          ? error.message
          : "PRICE_CURVE_MATERIALIZATION_FAILED",
      );
    }
  }
  return { created, skipped, errors: [...new Set(errors)] };
}
