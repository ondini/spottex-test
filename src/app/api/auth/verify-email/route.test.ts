import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verificationFind: vi.fn(),
  verificationUpdate: vi.fn(),
  userUpdate: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    emailVerification: { findUnique: mocks.verificationFind },
    $transaction: vi.fn(async (callback) => callback({
      emailVerification: { updateMany: mocks.verificationUpdate },
      user: { updateMany: mocks.userUpdate },
      auditLog: { create: mocks.auditCreate },
    })),
  },
}));

import { GET, POST } from "./route";

describe("email verification public redirects", () => {
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    vi.stubEnv("APP_URL", "https://spottex.cz");
    vi.stubEnv("AUTH_URL", "https://spottex.cz");
    mocks.verificationFind.mockReset();
    mocks.verificationUpdate.mockReset().mockResolvedValue({ count: 1 });
    mocks.userUpdate.mockReset().mockResolvedValue({ count: 1 });
    mocks.auditCreate.mockReset().mockResolvedValue({ id: 1 });
  });

  it("redirects an internally addressed Tunnel request to the public confirmation page", async () => {
    const token = "valid-test-token";
    mocks.verificationFind.mockResolvedValue({
      id: 1,
      userId: 2,
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });
    const request = new NextRequest(`http://0.0.0.0:3004/api/auth/verify-email?token=${token}`, {
      headers: {
        host: "spottex.cz",
        "x-forwarded-host": "spottex.cz",
        "x-forwarded-proto": "https",
      },
    });

    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`https://spottex.cz/overit-email?token=${token}`);
  });

  it("redirects an invalid token to the public login page", async () => {
    mocks.verificationFind.mockResolvedValue(null);
    const request = new NextRequest("http://0.0.0.0:3004/api/auth/verify-email?token=invalid");

    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://spottex.cz/prihlaseni?chyba=neplatny-odkaz");
  });

  it("redirects a successful confirmation POST back to the public login page", async () => {
    const token = "valid-test-token";
    mocks.verificationFind.mockResolvedValue({
      id: 1,
      userId: 2,
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });
    const request = new NextRequest("http://0.0.0.0:3004/api/auth/verify-email", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });

    const response = await POST(request);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://spottex.cz/prihlaseni?overeno=1");
    expect(mocks.verificationUpdate).toHaveBeenCalledOnce();
    expect(mocks.userUpdate).toHaveBeenCalledOnce();
  });
});
