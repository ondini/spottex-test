import { describe, expect, it } from "vitest";

import {
  findCatalogValue,
  latestCatalogActivity,
  normalizeCatalogKey,
} from "./catalog-contract";

describe("Costs catalog contract", () => {
  it("matches canonical lowercase keys with legacy camelCase lookups", () => {
    const values = [
      { key: "distributioncode", valueText: "D02d" },
      { key: "breakerfees", valueJson: { "3x25": 309.76 } },
      { key: "verificationstatus", valueText: "VERIFIED" },
    ];

    expect(findCatalogValue(values, ["distributionCode"])?.valueText).toBe("D02d");
    expect(findCatalogValue(values, ["breakerFees"])?.valueJson).toEqual({
      "3x25": 309.76,
    });
    expect(findCatalogValue(values, ["verificationStatus"])?.valueText).toBe(
      "VERIFIED",
    );
  });

  it("normalizes separators and diacritics deterministically", () => {
    expect(normalizeCatalogKey(" Měsíční-poplatek_CZK ")).toBe(
      "mesicnipoplatekczk",
    );
  });

  it("uses the latest attempt when no catalog row was imported", () => {
    const attemptedAt = new Date("2026-08-21T07:00:00.000Z");
    expect(latestCatalogActivity(null, attemptedAt)).toEqual(attemptedAt);
    expect(
      latestCatalogActivity(
        new Date("2026-08-20T07:00:00.000Z"),
        attemptedAt,
      ),
    ).toEqual(attemptedAt);
  });
});
