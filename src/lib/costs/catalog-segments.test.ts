import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { KNOWN_DISTRIBUTION_TARIFFS, catalogCustomerSegment, segmentForDistributionCode } from "./catalog-sync";

describe("catalog segments", () => {
  it("knows every low-voltage rate of the price decision, household and business", () => {
    expect(Object.keys(KNOWN_DISTRIBUTION_TARIFFS)).toEqual(expect.arrayContaining(["D01D", "D02D", "D25D", "D26D", "D27D", "D35D", "D45D", "D56D", "D57D", "C01D", "C02D", "C03D", "C25D", "C26D", "C27D", "C35D", "C45D", "C46D", "C56D"]));
  });

  it("derives the segment from the rate letter and lets the catalog override it", () => {
    expect(segmentForDistributionCode("C02D")).toBe("BUSINESS");
    expect(segmentForDistributionCode("d25d")).toBe("HOUSEHOLD");
    expect(catalogCustomerSegment(null, "C25D")).toBe("BUSINESS");
    expect(catalogCustomerSegment("business", "D02D")).toBe("BUSINESS");
    expect(catalogCustomerSegment("nonsense", "D02D")).toBe("HOUSEHOLD");
  });
});
