import { createHmac } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signOAuthState, verifyOAuthState } from "./oauth-state";

const originalAuthSecret = process.env.AUTH_SECRET;
const testSecret = "oauth-state-test-secret-with-at-least-32-characters";
const issuedAt = Date.UTC(2026, 6, 13, 12, 0, 0);

describe("Google Calendar OAuth state", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", testSecret);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(() => {
    expect(process.env.AUTH_SECRET).toBe(originalAuthSecret);
  });

  it("accepts a correctly signed state during its validity window", () => {
    const state = signOAuthState(42, 7, issuedAt);

    expect(verifyOAuthState(state, issuedAt)).toEqual({ userId: 42, issuedAt, disconnectEpoch: 7 });
    expect(verifyOAuthState(state, issuedAt + 15 * 60_000)).toEqual({ userId: 42, issuedAt, disconnectEpoch: 7 });
  });

  it("rejects tampered payloads and signatures", () => {
    const state = signOAuthState(42, 7, issuedAt);
    const [payload, signature] = state.split(".");
    const tamperedPayload = Buffer.from(JSON.stringify({ userId: 43, issuedAt, disconnectEpoch: 7 })).toString("base64url");
    const tamperedSignature = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;

    expect(verifyOAuthState(`${tamperedPayload}.${signature}`, issuedAt)).toBeNull();
    expect(verifyOAuthState(`${payload}.${tamperedSignature}`, issuedAt)).toBeNull();
    expect(verifyOAuthState(`${payload}.short`, issuedAt)).toBeNull();
  });

  it("rejects expired states and states issued too far in the future", () => {
    const state = signOAuthState(42, 7, issuedAt);

    expect(verifyOAuthState(state, issuedAt + 15 * 60_000 + 1)).toBeNull();
    expect(verifyOAuthState(state, issuedAt - 60_000)).toEqual({ userId: 42, issuedAt, disconnectEpoch: 7 });
    expect(verifyOAuthState(state, issuedAt - 60_001)).toBeNull();
  });

  it("rejects malformed state values", () => {
    expect(verifyOAuthState("", issuedAt)).toBeNull();
    expect(verifyOAuthState("not-a-state", issuedAt)).toBeNull();
    expect(verifyOAuthState("payload.signature.extra", issuedAt)).toBeNull();
  });

  it("requires a configured signing secret without leaking the stub", () => {
    vi.stubEnv("AUTH_SECRET", "");
    expect(() => signOAuthState(42, 7, issuedAt)).toThrow("AUTH_SECRET is required");
  });

  it("binds the state to a non-negative disconnect epoch", () => {
    expect(() => signOAuthState(42, -1, issuedAt)).toThrow("Invalid OAuth disconnect epoch");
    const legacyPayload = Buffer.from(JSON.stringify({ userId: 42, issuedAt })).toString("base64url");
    const signature = createHmac("sha256", testSecret).update(legacyPayload).digest("base64url");
    expect(verifyOAuthState(`${legacyPayload}.${signature}`, issuedAt)).toBeNull();
  });
});
