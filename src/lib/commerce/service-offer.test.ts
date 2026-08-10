import { describe, expect, it } from "vitest";

import { calculateAnnualControlOffer } from "./service-offer";

describe("annual control offer", () => {
  it("charges one quarter of the expected control savings below the cap", () => {
    expect(calculateAnnualControlOffer(100_000)).toMatchObject({
      expectedControlSavingsMinor: 100_000,
      finalPriceMinor: 25_000,
      discountMinor: 74_000,
      discountPercent: 75,
    });
  });

  it("caps the annual price at 990 CZK", () => {
    expect(calculateAnnualControlOffer(400_000)).toMatchObject({
      finalPriceMinor: 99_000,
      discountMinor: 0,
    });
    expect(calculateAnnualControlOffer(900_000).finalPriceMinor).toBe(99_000);
  });

  it("never creates a negative price from a negative simulated saving", () => {
    expect(calculateAnnualControlOffer(-10_000).finalPriceMinor).toBe(0);
  });
});
