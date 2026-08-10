import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { invoiceYearFor, recurringPaymentParameters, safeGopayGatewayUrl } from "./payment";

describe("payment safety helpers", () => {
  it("uses the Czech accounting year at the UTC year boundary", () => {
    expect(invoiceYearFor(new Date("2026-12-31T22:59:59.999Z"))).toBe(2026);
    expect(invoiceYearFor(new Date("2026-12-31T23:00:00.000Z"))).toBe(2027);
  });

  it("accepts only HTTPS GoPay gateway URLs", () => {
    expect(safeGopayGatewayUrl("https://gw.sandbox.gopay.com/gw/123")).toBe("https://gw.sandbox.gopay.com/gw/123");
    expect(safeGopayGatewayUrl("http://gw.sandbox.gopay.com/gw/123")).toBeNull();
    expect(safeGopayGatewayUrl("https://gopay.com.evil.test/gw/123")).toBeNull();
  });

  it("creates a bounded ON_DEMAND mandate snapshot without card data", () => {
    const parameters = recurringPaymentParameters(new Date("2026-07-21T12:00:00.000Z"));
    expect(parameters.recurrence).toEqual({
      recurrence_cycle: "ON_DEMAND",
      recurrence_date_to: "2029-07-21",
    });
    expect(parameters.consent).toMatchObject({
      accepted: true,
      version: "2026-07-21",
      maxAmountMinor: 99_000,
      renewalPeriodDays: 365,
      noticeDays: 14,
    });
    expect(parameters.consent.textSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
