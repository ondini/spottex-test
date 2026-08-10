import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiAdmin: vi.fn(),
  exchangeCode: vi.fn(),
  fetchEmail: vi.fn(),
  calendarFind: vi.fn(),
  calendarUpsert: vi.fn(),
  auditCreate: vi.fn(),
  userFind: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ apiAdmin: mocks.apiAdmin }));
vi.mock("@/lib/consultation/google-calendar", () => ({
  exchangeGoogleCode: mocks.exchangeCode,
  fetchGoogleEmail: mocks.fetchEmail,
}));
vi.mock("@/lib/prisma", () => {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    consultationHostCalendar: {
      findUnique: mocks.calendarFind,
      upsert: mocks.calendarUpsert,
    },
    auditLog: { create: mocks.auditCreate },
    user: { findFirst: mocks.userFind },
  };
  return {
    prisma: {
      user: { findFirst: mocks.userFind },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    },
  };
});

import { signOAuthState } from "@/lib/consultation/oauth-state";
import { GET } from "./route";

describe("Google Calendar OAuth callback disconnect race", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", "callback-route-test-secret-with-at-least-32-chars");
    vi.stubEnv("APP_URL", "https://spottex.example.test");
    mocks.apiAdmin.mockResolvedValue({ user: { id: "9", role: "ADMIN" } });
    mocks.userFind.mockReset().mockResolvedValue({ id: 9 });
    mocks.calendarFind.mockReset().mockResolvedValue({
      id: 1,
      metadata: { oauthDisconnectEpoch: 2 },
      targetCalendarId: "target@example.test",
      autoMeet: true,
      encryptedAccessToken: "access",
      encryptedRefreshToken: "refresh",
    });
    mocks.exchangeCode.mockReset();
    mocks.fetchEmail.mockReset();
    mocks.calendarUpsert.mockReset();
    mocks.auditCreate.mockReset();
  });

  it("does not exchange a one-time code after disconnect advanced the epoch", async () => {
    const state = signOAuthState(9, 1);
    const request = new NextRequest(
      `https://spottex.example.test/api/admin/google-calendar/callback?code=one-time-code&state=${encodeURIComponent(state)}`,
      { headers: { cookie: `spottex_google_oauth_state=${state}` } },
    );

    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://spottex.example.test/admin/konzultace?error=state");
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
    expect(mocks.calendarUpsert).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});
