import { afterEach, describe, expect, it, vi } from "vitest";

import { emailVerificationUrl, publicAppUrl } from "./verification-url";

afterEach(() => vi.unstubAllEnvs());

describe("verification URLs", () => {
  it("always generates an email link on the configured public origin", () => {
    vi.stubEnv("APP_URL", "https://spottex.cz");
    vi.stubEnv("AUTH_URL", "http://0.0.0.0:3004");

    expect(emailVerificationUrl("token with spaces")).toBe(
      "https://spottex.cz/api/auth/verify-email?token=token+with+spaces",
    );
  });

  it("replaces any internal fallback path, query and fragment", () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("AUTH_URL", "");

    expect(publicAppUrl("/overit-email", "http://0.0.0.0:3004/internal?wrong=1#fragment").toString()).toBe(
      "http://0.0.0.0:3004/overit-email",
    );
  });
});
