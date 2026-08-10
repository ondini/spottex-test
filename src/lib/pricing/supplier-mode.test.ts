import { describe, expect, it } from "vitest";

import { supplierFulfillment } from "./supplier-mode";

describe("supplier fulfillment mode", () => {
  it("defaults safely to comparison without an external redirect", () => {
    expect(supplierFulfillment(undefined)).toMatchObject({
      mode: "COMPARISON_ONLY",
      directContractingAvailable: false,
    });
  });

  it("enables the internal offer without changing simulation configuration", () => {
    expect(supplierFulfillment("SPOTTEX_SUPPLIER")).toMatchObject({
      mode: "SPOTTEX_SUPPLIER",
      directContractingAvailable: true,
    });
  });
});
