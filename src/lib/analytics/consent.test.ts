import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { signConsentCookie, verifyConsentCookie } from "@/lib/analytics/consent";

const originalSecret = process.env.AUTH_SECRET;

describe("signed analytics consent", () => {
  beforeEach(() => { process.env.AUTH_SECRET = "test-consent-signing-secret-with-at-least-32-characters"; });
  afterEach(() => { process.env.AUTH_SECRET = originalSecret; });

  it("round-trips an authentic consent selection", () => {
    const value = signConsentCookie({ a: true, m: false, v: "2026-07" });
    expect(verifyConsentCookie(value)).toEqual({ a: true, m: false, v: "2026-07" });
  });

  it("rejects tampered and malformed cookies", () => {
    const value = signConsentCookie({ a: true, m: true, v: "2026-07" });
    expect(verifyConsentCookie(`${value.slice(0, -1)}x`)).toBeNull();
    expect(verifyConsentCookie("not-a-cookie")).toBeNull();
  });
});
