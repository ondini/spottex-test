import { describe, expect, it } from "vitest";

import { planMarketSeriesPublish } from "./market-series-plan";

const start = new Date("2025-09-30T22:00:00Z");
const source = "backend:control.ote_prices_15min";

describe("planMarketSeriesPublish", () => {
  it("extends the published series when the daily sync only moves the horizon", () => {
    expect(
      planMarketSeriesPublish({ current: { validFrom: start, sourceUrl: source }, validFrom: start, sourceUrl: source }),
    ).toBe("EXTEND");
  });

  it("creates a new series when the start moves", () => {
    expect(
      planMarketSeriesPublish({
        current: { validFrom: start, sourceUrl: source },
        validFrom: new Date("2025-10-01T22:00:00Z"),
        sourceUrl: source,
      }),
    ).toBe("CREATE");
  });

  it("creates a new series for a different source and when nothing is published", () => {
    expect(
      planMarketSeriesPublish({ current: { validFrom: start, sourceUrl: source }, validFrom: start, sourceUrl: "https://www.ote-cr.cz/" }),
    ).toBe("CREATE");
    expect(planMarketSeriesPublish({ current: null, validFrom: start, sourceUrl: source })).toBe("CREATE");
  });
});
