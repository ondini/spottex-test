import { NextRequest, NextResponse } from "next/server";

import { encryptSecret } from "@/lib/crypto";
import { hashToken, safeTokenEqual } from "@/lib/crypto";
import { apiAdmin } from "@/lib/auth/guards";
import { isCurrentCalendarOAuthState, lockHostCalendarState } from "@/lib/consultation/calendar-state";
import { exchangeGoogleCode, fetchGoogleEmail } from "@/lib/consultation/google-calendar";
import { verifyOAuthState } from "@/lib/consultation/oauth-state";
import { prisma } from "@/lib/prisma";

function adminRedirect(path: string) {
  const base = (process.env.APP_URL || process.env.AUTH_URL || "http://localhost:3004").replace(/\/$/, "");
  const response = NextResponse.redirect(`${base}${path}`);
  response.cookies.set("spottex_google_oauth_state", "", { maxAge: 0, path: "/api/admin/google-calendar/callback" });
  return response;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!code || !state) return adminRedirect("/admin/konzultace?error=oauth");
  const session = await apiAdmin();
  const stateCookie = request.cookies.get("spottex_google_oauth_state")?.value;
  if (!session || !stateCookie || !safeTokenEqual(state, hashToken(stateCookie))) return adminRedirect("/admin/konzultace?error=state");
  const oauthState = verifyOAuthState(state);
  if (!oauthState || oauthState.userId !== Number(session.user.id)) return adminRedirect("/admin/konzultace?error=state");
  const hostUserId = oauthState.userId;
  const host = await prisma.user.findFirst({ where: { id: hostUserId, role: "ADMIN", status: "ACTIVE" }, select: { id: true } });
  if (!host) return adminRedirect("/admin/konzultace?error=account");
  try {
    const result = await prisma.$transaction(async (tx) => {
      const calendar = await lockHostCalendarState(tx, hostUserId);
      if (!isCurrentCalendarOAuthState(calendar?.metadata, oauthState.disconnectEpoch)) return "STALE" as const;
      const activeHost = await tx.user.findFirst({
        where: { id: hostUserId, role: "ADMIN", status: "ACTIVE" },
        select: { id: true },
      });
      if (!activeHost) return "ACCOUNT" as const;
      // Keep the host advisory lock over the one-time code exchange. If a
      // disconnect stages first, the code is never exchanged. If this callback
      // wins, disconnect waits and then revokes the newly persisted grant.
      const tokens = await exchangeGoogleCode(code);
      const googleEmail = await fetchGoogleEmail(tokens.accessToken).catch((error) => {
        console.error("Google Calendar account email lookup failed", error);
        return null;
      });
      if (!tokens.refreshToken && !calendar?.encryptedRefreshToken) return "NO_REFRESH" as const;
      const connected = await tx.consultationHostCalendar.upsert({
        where: { hostUserId },
        create: {
          hostUserId,
          googleEmail,
          encryptedAccessToken: encryptSecret(tokens.accessToken),
          encryptedRefreshToken: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
          tokenExpiresAt: new Date(Date.now() + tokens.expiresInSeconds * 1000),
        },
        update: {
          googleEmail,
          encryptedAccessToken: encryptSecret(tokens.accessToken),
          ...(tokens.refreshToken ? { encryptedRefreshToken: encryptSecret(tokens.refreshToken) } : {}),
          tokenExpiresAt: new Date(Date.now() + tokens.expiresInSeconds * 1000),
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: hostUserId,
          action: "GOOGLE_CALENDAR_CONNECTED",
          entityType: "ConsultationHostCalendar",
          entityId: String(connected.id),
          metadata: { oauthDisconnectEpoch: oauthState.disconnectEpoch, oauthIssuedAt: new Date(oauthState.issuedAt).toISOString() },
        },
      });
      return "CONNECTED" as const;
    }, { maxWait: 5_000, timeout: 30_000 });
    if (result === "STALE") return adminRedirect("/admin/konzultace?error=state");
    if (result === "ACCOUNT") return adminRedirect("/admin/konzultace?error=account");
    if (result === "NO_REFRESH") return adminRedirect("/admin/konzultace?error=no_refresh_token");
    return adminRedirect("/admin/konzultace?connected=1");
  } catch (error) {
    console.error("Google Calendar OAuth callback failed", error);
    return adminRedirect("/admin/konzultace?error=token");
  }
}
