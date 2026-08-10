import { NextResponse } from "next/server";

import { apiAdmin } from "@/lib/auth/guards";
import { calendarDisconnectEpoch, isCalendarDisconnecting, lockHostCalendarState } from "@/lib/consultation/calendar-state";
import { buildGoogleAuthorizeUrl } from "@/lib/consultation/google-calendar";
import { signOAuthState } from "@/lib/consultation/oauth-state";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await apiAdmin();
  if (!session) return NextResponse.redirect(`${process.env.APP_URL || "http://localhost:3004"}/prihlaseni?callbackUrl=/admin/konzultace`);
  try {
    const hostUserId = Number(session.user.id);
    const disconnectEpoch = await prisma.$transaction(async (tx) => {
      const calendar = await lockHostCalendarState(tx, hostUserId);
      if (isCalendarDisconnecting(calendar?.metadata)) throw new Error("CALENDAR_DISCONNECTING");
      return calendarDisconnectEpoch(calendar?.metadata);
    });
    const state = signOAuthState(hostUserId, disconnectEpoch);
    const response = NextResponse.redirect(buildGoogleAuthorizeUrl(state));
    response.cookies.set("spottex_google_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 15 * 60,
      path: "/api/admin/google-calendar/callback",
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.message === "CALENDAR_DISCONNECTING") {
      return NextResponse.redirect(`${process.env.APP_URL || "http://localhost:3004"}/admin/konzultace?error=disconnecting`);
    }
    console.error("Google Calendar OAuth initialization failed", error);
    return NextResponse.redirect(`${process.env.APP_URL || "http://localhost:3004"}/admin/konzultace?error=config`);
  }
}
