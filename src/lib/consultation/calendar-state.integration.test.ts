import { randomUUID } from "node:crypto";

import { UserRole, UserStatus } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import {
  isCurrentCalendarOAuthState,
  lockHostCalendarState,
  stableCalendarMetadata,
  stageCalendarDisconnect,
} from "./calendar-state";
import { getGoogleAccessToken, GoogleCalendarAuthError } from "./google-calendar";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

const databaseDescribe = process.env.RUN_DB_INTEGRATION_TESTS === "true" ? describe : describe.skip;

databaseDescribe("Google Calendar OAuth/disconnect PostgreSQL serialization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("makes an older callback wait for disconnect staging and then rejects its epoch", async () => {
    const suffix = randomUUID();
    const host = await prisma.user.create({
      data: {
        email: `calendar-oauth-race-${suffix}@example.test`,
        passwordHash: "not-a-login-password",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        consultationCalendar: {
          create: {
            encryptedAccessToken: "old-encrypted-access-token",
            encryptedRefreshToken: "old-encrypted-refresh-token",
            metadata: { oauthDisconnectEpoch: 0 },
          },
        },
      },
    });

    let releaseDisconnect!: () => void;
    const disconnectCanCommit = new Promise<void>((resolve) => {
      releaseDisconnect = resolve;
    });
    let disconnectLocked!: () => void;
    const disconnectHasLock = new Promise<void>((resolve) => {
      disconnectLocked = resolve;
    });
    let callbackAcquiredLock = false;

    try {
      const disconnect = prisma.$transaction(async (tx) => {
        const calendar = await lockHostCalendarState(tx, host.id);
        disconnectLocked();
        await disconnectCanCommit;
        const staged = stageCalendarDisconnect(calendar?.metadata, "race-operation", new Date());
        await tx.consultationHostCalendar.update({
          where: { hostUserId: host.id },
          data: { metadata: staged.metadata },
        });
      }, { maxWait: 5_000, timeout: 10_000 });

      await disconnectHasLock;
      const staleCallback = prisma.$transaction(async (tx) => {
        const calendar = await lockHostCalendarState(tx, host.id);
        callbackAcquiredLock = true;
        if (!isCurrentCalendarOAuthState(calendar?.metadata, 0)) return false;
        await tx.consultationHostCalendar.update({
          where: { hostUserId: host.id },
          data: { encryptedRefreshToken: "stale-callback-token" },
        });
        return true;
      }, { maxWait: 5_000, timeout: 10_000 });

      await new Promise((resolve) => setTimeout(resolve, 75));
      expect(callbackAcquiredLock).toBe(false);
      releaseDisconnect();
      await disconnect;
      await expect(staleCallback).resolves.toBe(false);

      // Simulate a true revocation network failure: clear only the stage, not
      // the persisted epoch or local credentials.
      await prisma.$transaction(async (tx) => {
        const calendar = await lockHostCalendarState(tx, host.id);
        await tx.consultationHostCalendar.update({
          where: { hostUserId: host.id },
          data: { metadata: stableCalendarMetadata(calendar?.metadata) },
        });
      });
      const stored = await prisma.consultationHostCalendar.findUniqueOrThrow({ where: { hostUserId: host.id } });
      expect(stored.metadata).toMatchObject({ oauthDisconnectEpoch: 1 });
      expect(stored.encryptedAccessToken).toBe("old-encrypted-access-token");
      expect(stored.encryptedRefreshToken).toBe("old-encrypted-refresh-token");
      expect(isCurrentCalendarOAuthState(stored.metadata, 0)).toBe(false);
    } finally {
      releaseDisconnect();
      await prisma.user.deleteMany({ where: { id: host.id } });
    }
  }, 20_000);

  it("does not resurrect access credentials when a deferred refresh finishes after disconnect finalization", async () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", Buffer.alloc(32, 13).toString("base64"));
    vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID", "calendar-client-id");
    vi.stubEnv("GOOGLE_CALENDAR_CLIENT_SECRET", "calendar-client-secret");
    const suffix = randomUUID();
    const host = await prisma.user.create({
      data: {
        email: `calendar-refresh-race-${suffix}@example.test`,
        passwordHash: "not-a-login-password",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        consultationCalendar: {
          create: {
            encryptedAccessToken: encryptSecret("expired-access-token"),
            encryptedRefreshToken: encryptSecret("refresh-token-before-disconnect"),
            tokenExpiresAt: new Date(Date.now() - 60_000),
            metadata: { oauthDisconnectEpoch: 0 },
          },
        },
      },
    });

    let releaseGoogle!: (response: Response) => void;
    const googleResponse = new Promise<Response>((resolve) => {
      releaseGoogle = resolve;
    });
    let markRefreshStarted!: () => void;
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshStarted = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(async () => {
      markRefreshStarted();
      return googleResponse;
    }));

    let deferredRefresh: Promise<string | null> | null = null;
    try {
      deferredRefresh = getGoogleAccessToken(host.id);
      await refreshStarted;

      await prisma.$transaction(async (tx) => {
        const calendar = await lockHostCalendarState(tx, host.id);
        const staged = stageCalendarDisconnect(calendar?.metadata, "refresh-race-disconnect", new Date());
        await tx.consultationHostCalendar.update({
          where: { hostUserId: host.id },
          data: {
            encryptedAccessToken: null,
            encryptedRefreshToken: null,
            tokenExpiresAt: null,
            metadata: stableCalendarMetadata(staged.metadata),
          },
        });
      });

      releaseGoogle(new Response(JSON.stringify({
        access_token: "must-never-be-persisted-or-returned",
        expires_in: 3600,
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

      await expect(deferredRefresh).rejects.toBeInstanceOf(GoogleCalendarAuthError);
      const stored = await prisma.consultationHostCalendar.findUniqueOrThrow({ where: { hostUserId: host.id } });
      expect(stored.encryptedAccessToken).toBeNull();
      expect(stored.encryptedRefreshToken).toBeNull();
      expect(stored.tokenExpiresAt).toBeNull();
      expect(stored.metadata).toMatchObject({ oauthDisconnectEpoch: 1 });
    } finally {
      releaseGoogle(new Response(JSON.stringify({ error: "cleanup" }), { status: 500 }));
      await deferredRefresh?.catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: host.id } });
    }
  }, 20_000);
});
