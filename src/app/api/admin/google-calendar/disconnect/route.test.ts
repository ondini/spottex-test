import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiAdmin: vi.fn(),
  revokeGrant: vi.fn(),
  auditCreate: vi.fn(),
  calendar: null as null | {
    id: number;
    hostUserId: number;
    googleEmail: string | null;
    encryptedAccessToken: string | null;
    encryptedRefreshToken: string | null;
    tokenExpiresAt: Date | null;
    targetCalendarId: string | null;
    autoMeet: boolean;
    metadata: Record<string, unknown>;
  },
}));

vi.mock("@/lib/auth/guards", () => ({ apiAdmin: mocks.apiAdmin }));
vi.mock("@/lib/consultation/google-calendar", () => ({ revokeGoogleCalendarGrant: mocks.revokeGrant }));
vi.mock("@/lib/crypto", () => ({ decryptSecret: (value: string) => `plain:${value}` }));
vi.mock("@/lib/prisma", () => {
  const consultationHostCalendar = {
    findUnique: vi.fn(async () => mocks.calendar ? { ...mocks.calendar } : null),
    create: vi.fn(async ({ data }: { data: { hostUserId: number; metadata: Record<string, unknown> } }) => {
      mocks.calendar = {
        id: 1,
        hostUserId: data.hostUserId,
        googleEmail: null,
        encryptedAccessToken: null,
        encryptedRefreshToken: null,
        tokenExpiresAt: null,
        targetCalendarId: null,
        autoMeet: true,
        metadata: data.metadata,
      };
      return { ...mocks.calendar };
    }),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (!mocks.calendar) throw new Error("missing calendar fixture");
      mocks.calendar = { ...mocks.calendar, ...data } as typeof mocks.calendar;
      return { ...mocks.calendar };
    }),
  };
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    consultationHostCalendar,
    consultationSlot: { count: vi.fn().mockResolvedValue(0) },
    scheduledJob: { count: vi.fn().mockResolvedValue(0) },
    auditLog: { create: mocks.auditCreate },
  };
  return {
    prisma: {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    },
  };
});

import { POST } from "./route";

describe("Google Calendar disconnect failure semantics", () => {
  beforeEach(() => {
    mocks.apiAdmin.mockResolvedValue({ user: { id: "9", role: "ADMIN" } });
    mocks.revokeGrant.mockReset();
    mocks.auditCreate.mockReset().mockResolvedValue({ id: 1 });
    mocks.calendar = {
      id: 1,
      hostUserId: 9,
      googleEmail: "admin@example.test",
      encryptedAccessToken: "encrypted-access",
      encryptedRefreshToken: "encrypted-refresh",
      tokenExpiresAt: new Date("2026-07-14T11:00:00Z"),
      targetCalendarId: "target@example.test",
      autoMeet: true,
      metadata: { oauthDisconnectEpoch: 2, custom: "preserved" },
    };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("preserves local credentials on a genuine network failure but keeps the incremented epoch", async () => {
    mocks.revokeGrant.mockRejectedValue(new TypeError("network down"));

    const response = await POST();

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "GOOGLE_REVOCATION_FAILED" });
    expect(mocks.revokeGrant).toHaveBeenCalledWith("plain:encrypted-refresh");
    expect(mocks.calendar).toMatchObject({
      encryptedAccessToken: "encrypted-access",
      encryptedRefreshToken: "encrypted-refresh",
      metadata: { oauthDisconnectEpoch: 3, custom: "preserved" },
    });
    expect((mocks.calendar?.metadata as Record<string, unknown>).disconnecting).toBeUndefined();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("locally clears credentials when Google reports the grant already revoked", async () => {
    mocks.revokeGrant.mockResolvedValue("ALREADY_REVOKED");

    const response = await POST();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.calendar).toMatchObject({
      googleEmail: null,
      encryptedAccessToken: null,
      encryptedRefreshToken: null,
      tokenExpiresAt: null,
      metadata: { oauthDisconnectEpoch: 3, custom: "preserved" },
    });
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "GOOGLE_CALENDAR_DISCONNECTED",
        metadata: { providerResult: "ALREADY_REVOKED" },
      }),
    });
  });
});
