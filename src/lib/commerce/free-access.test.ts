import { afterEach, describe, expect, it, vi } from "vitest";

import { freeAccessEnabled } from "./free-access";

afterEach(() => vi.unstubAllEnvs());

describe("free access mode", () => {
  it("is enabled explicitly or by the FREE provider", () => {
    vi.stubEnv("FREE_ACCESS_MODE", "true");
    vi.stubEnv("PAYMENT_PROVIDER", "GOPAY");
    expect(freeAccessEnabled()).toBe(true);

    vi.stubEnv("FREE_ACCESS_MODE", "false");
    vi.stubEnv("PAYMENT_PROVIDER", "FREE");
    expect(freeAccessEnabled()).toBe(true);
  });

  it("does not make a paid provider free by default", () => {
    vi.stubEnv("FREE_ACCESS_MODE", "false");
    vi.stubEnv("PAYMENT_PROVIDER", "GOPAY");
    expect(freeAccessEnabled()).toBe(false);
  });
});
