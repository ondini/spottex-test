import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { apiAdmin } from "@/lib/auth/guards";
import { isCalendarDisconnecting, lockHostCalendarState } from "@/lib/consultation/calendar-state";
import { getGoogleAccessToken, GoogleCalendarAuthError, listGoogleCalendars } from "@/lib/consultation/google-calendar";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  maskCalendarIds: z.array(z.string().min(1).max(500)).max(50).optional(),
  targetCalendarId: z.string().min(1).max(500).nullable().optional(),
  autoMeet: z.boolean().optional(),
  targetSlotsPerWeek: z.number().int().min(1).max(100).optional(),
});

export async function GET() {
  const session = await apiAdmin();
  if (!session) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const hostUserId = Number(session.user.id);
  const calendar = await prisma.consultationHostCalendar.findUnique({ where: { hostUserId } });
  let calendars: Awaited<ReturnType<typeof listGoogleCalendars>> = [];
  let calendarError: string | null = null;
  if (calendar?.encryptedRefreshToken) {
    try {
      const accessToken = await getGoogleAccessToken(hostUserId);
      if (accessToken) calendars = await listGoogleCalendars(accessToken);
    } catch (error) {
      calendarError = error instanceof GoogleCalendarAuthError ? "REAUTHORIZE" : "LIST_FAILED";
    }
  }
  return NextResponse.json({
    connected: Boolean(calendar?.encryptedRefreshToken),
    googleEmail: calendar?.googleEmail || null,
    maskCalendarIds: calendar?.maskCalendarIds || [],
    targetCalendarId: calendar?.targetCalendarId || null,
    autoMeet: calendar?.autoMeet ?? true,
    targetSlotsPerWeek: calendar?.targetSlotsPerWeek ?? 10,
    calendars,
    calendarError,
    configured: Boolean(process.env.GOOGLE_CALENDAR_CLIENT_ID && process.env.GOOGLE_CALENDAR_CLIENT_SECRET),
  });
}

export async function PATCH(request: NextRequest) {
  const session = await apiAdmin();
  if (!session) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const hostUserId = Number(session.user.id);
  const result = await prisma.$transaction(async (tx) => {
    const state = await lockHostCalendarState(tx, hostUserId);
    if (isCalendarDisconnecting(state?.metadata)) return null;
    const calendar = await tx.consultationHostCalendar.upsert({
      where: { hostUserId },
      update: parsed.data,
      create: { hostUserId, ...parsed.data },
    });
    await tx.auditLog.create({ data: { actorUserId: hostUserId, action: "CONSULTATION_CALENDAR_SETTINGS_UPDATED", entityType: "ConsultationHostCalendar", entityId: String(calendar.id) } });
    return calendar;
  });
  if (!result) return NextResponse.json({ error: "CALENDAR_DISCONNECTING" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
