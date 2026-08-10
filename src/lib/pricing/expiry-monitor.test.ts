import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { catalogExpirySeverity } from "./expiry-monitor";

describe("catalog expiry monitoring", () => {
  const now = new Date("2026-07-21T00:00:00.000Z");
  it("classifies deadlines deterministically", () => {
    expect(catalogExpirySeverity(new Date("2026-07-20T00:00:00.000Z"), now)).toBe("EXPIRED");
    expect(catalogExpirySeverity(new Date("2026-07-30T00:00:00.000Z"), now)).toBe("CRITICAL");
    expect(catalogExpirySeverity(new Date("2026-08-20T00:00:00.000Z"), now)).toBe("WARNING");
    expect(catalogExpirySeverity(new Date("2027-01-01T00:00:00.000Z"), now)).toBeNull();
  });
});
