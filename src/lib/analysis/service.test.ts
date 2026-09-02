import { describe, expect, it } from "vitest";

import {
  priceCurveWarningMessages,
  sanitizePriceCurveWarningCodes,
} from "./service";

describe("current-tariff price curve warnings", () => {
  it("maps known codes to stable Czech messages and deduplicates", () => {
    expect(
      priceCurveWarningMessages([
        "PRICE_CURVE_CURRENT_SELL_PRICE_MISSING",
        "PRICE_CURVE_CURRENT_SELL_PRICE_MISSING",
        "PRICE_CURVE_MARKET_SERIES_MISSING",
      ]),
    ).toEqual([
      "Vlastní tarif nelze sestavit: chybí fixní výkupní cena.",
      "Vlastní tarif nelze sestavit: nejsou publikované tržní ceny pro spotovou část.",
    ]);
  });

  it("falls back to one generic message for unknown codes and ignores malformed input", () => {
    expect(
      priceCurveWarningMessages(["SOMETHING_ELSE", "ANOTHER_UNKNOWN"]),
    ).toEqual(["Vlastní tarif se nepodařilo připravit."]);
    expect(priceCurveWarningMessages(undefined)).toEqual([]);
    expect(priceCurveWarningMessages("PRICE_CURVE_MARKET_SERIES_MISSING")).toEqual([]);
    expect(priceCurveWarningMessages([42, null])).toEqual([]);
  });

  it("persists only stable codes, never raw error text", () => {
    expect(
      sanitizePriceCurveWarningCodes([
        "PRICE_CURVE_CURRENT_PRODUCT_MISSING",
        "connect ECONNREFUSED 127.0.0.1:5432",
        "PRICE_CURVE_CURRENT_PRODUCT_MISSING",
      ]),
    ).toEqual([
      "PRICE_CURVE_CURRENT_PRODUCT_MISSING",
      "PRICE_CURVE_CURRENT_BASELINE_FAILED",
    ]);
  });
});
