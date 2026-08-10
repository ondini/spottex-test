import { Prisma } from "@prisma/client";

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { isCalendarDisconnecting } from "@/lib/consultation/calendar-state";
import { prisma } from "@/lib/prisma";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const googleTimeout = () => AbortSignal.timeout(10_000);

type JsonRecord = Record<string, unknown>;

export class GoogleCalendarAuthError extends Error {}

export type GoogleGrantRevocationResult = "REVOKED" | "ALREADY_REVOKED";

export async function revokeGoogleCalendarGrant(token: string): Promise<GoogleGrantRevocationResult> {
  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    signal: googleTimeout(),
  });
  if (response.ok) return "REVOKED";
  // Google's revocation endpoint returns 400 for an invalid token. This also
  // covers a refresh grant that was already revoked outside Spottex.
  if (response.status === 400) return "ALREADY_REVOKED";
  throw new Error(`Google grant revocation failed (${response.status})`);
}

function clientCredentials() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google Calendar credentials are not configured");
  return { clientId, clientSecret };
}

export function googleRedirectUri(): string {
  return process.env.GOOGLE_CALENDAR_REDIRECT_URI
    || `${(process.env.APP_URL || process.env.AUTH_URL || "http://localhost:3004").replace(/\/$/, "")}/api/admin/google-calendar/callback`;
}

export function buildGoogleAuthorizeUrl(state: string): string {
  const { clientId } = clientCredentials();
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    scope: [
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
    ].join(" "),
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
}

async function readJson(response: Response): Promise<JsonRecord> {
  const value: unknown = await response.json().catch(() => ({}));
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

export async function exchangeGoogleCode(code: string) {
  const { clientId, clientSecret } = clientCredentials();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
    }),
    signal: googleTimeout(),
  });
  const json = await readJson(response);
  if (!response.ok || typeof json.access_token !== "string") throw new Error(`Google token exchange failed (${String(json.error || response.status)})`);
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : null,
    expiresInSeconds: typeof json.expires_in === "number" ? json.expires_in : 3600,
  };
}

async function refreshGoogleToken(refreshToken: string) {
  const { clientId, clientSecret } = clientCredentials();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: googleTimeout(),
  });
  const json = await readJson(response);
  if (!response.ok || typeof json.access_token !== "string") {
    if (json.error === "invalid_grant") throw new GoogleCalendarAuthError("Google Calendar authorization expired");
    throw new Error(`Google token refresh failed (${String(json.error || response.status)})`);
  }
  return { accessToken: json.access_token, expiresInSeconds: typeof json.expires_in === "number" ? json.expires_in : 3600 };
}

type CalendarTokenClient = Pick<Prisma.TransactionClient, "consultationHostCalendar">;

export async function getGoogleAccessToken(hostUserId: number, db: CalendarTokenClient = prisma): Promise<string | null> {
  const calendar = await db.consultationHostCalendar.findUnique({ where: { hostUserId } });
  if (!calendar?.encryptedRefreshToken) return null;
  if (isCalendarDisconnecting(calendar.metadata)) {
    throw new GoogleCalendarAuthError("Google Calendar is disconnecting");
  }
  if (calendar.encryptedAccessToken && calendar.tokenExpiresAt && calendar.tokenExpiresAt.getTime() > Date.now() + 60_000) {
    return decryptSecret(calendar.encryptedAccessToken);
  }
  const refreshed = await refreshGoogleToken(decryptSecret(calendar.encryptedRefreshToken));
  const persisted = await db.consultationHostCalendar.updateMany({
    where: {
      hostUserId,
      encryptedRefreshToken: calendar.encryptedRefreshToken,
      // Exact metadata equality is a CAS for oauthDisconnectEpoch and the
      // disconnecting stage. A disconnect attempt permanently changes the
      // epoch, even when provider revocation later fails.
      metadata: { equals: calendar.metadata as Prisma.InputJsonValue },
    },
    data: {
      encryptedAccessToken: encryptSecret(refreshed.accessToken),
      tokenExpiresAt: new Date(Date.now() + refreshed.expiresInSeconds * 1000),
    },
  });
  if (!persisted.count) {
    throw new GoogleCalendarAuthError("Google Calendar connection changed while refreshing authorization");
  }
  return refreshed.accessToken;
}

export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${accessToken}` }, signal: googleTimeout() });
  const json = await readJson(response);
  return typeof json.email === "string" ? json.email : null;
}

export type GoogleCalendarItem = { id: string; summary: string; primary: boolean };

function calendarDateAtMidnightUtc(value: string, timeZone: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return new Date(Number.NaN);
  const wallClock = Date.UTC(year, month - 1, day);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const offsetAt = (instant: Date) => {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour === "24" ? "0" : parts.hour), Number(parts.minute), Number(parts.second)) - instant.getTime();
  };
  const firstOffset = offsetAt(new Date(wallClock));
  let instant = wallClock - firstOffset;
  const correctedOffset = offsetAt(new Date(instant));
  if (correctedOffset !== firstOffset) instant = wallClock - correctedOffset;
  return new Date(instant);
}

export async function listGoogleCalendars(accessToken: string): Promise<GoogleCalendarItem[]> {
  const response = await fetch(`${CALENDAR_API}/users/me/calendarList`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: googleTimeout() });
  const json = await readJson(response);
  if (!response.ok) throw new Error("Google Calendar list failed");
  const items = Array.isArray(json.items) ? json.items : [];
  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as JsonRecord;
    if (typeof row.id !== "string") return [];
    return [{ id: row.id, summary: typeof row.summary === "string" ? row.summary : row.id, primary: row.primary === true }];
  });
}

export async function listBusyCalendarIntervals(options: {
  accessToken: string;
  calendarIds: string[];
  timeMin: Date;
  timeMax: Date;
}): Promise<Array<{ start: Date; end: Date }>> {
  const busy: Array<{ start: Date; end: Date }> = [];
  for (const calendarId of options.calendarIds) {
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams({
        timeMin: options.timeMin.toISOString(),
        timeMax: options.timeMax.toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "2500",
      });
      if (pageToken) query.set("pageToken", pageToken);
      const response = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${query}`, {
        headers: { Authorization: `Bearer ${options.accessToken}` },
        signal: googleTimeout(),
      });
      const json = await readJson(response);
      if (!response.ok) throw new Error(`Google Calendar busy check failed (${response.status})`);
      const calendarTimeZone = typeof json.timeZone === "string" ? json.timeZone : "Europe/Prague";
      const events = Array.isArray(json.items) ? json.items : [];
      for (const event of events) {
        if (!event || typeof event !== "object") continue;
        const row = event as JsonRecord;
        if (row.status === "cancelled" || ["birthday", "workingLocation", "fromGmail"].includes(String(row.eventType))) continue;
        const start = row.start && typeof row.start === "object" ? row.start as JsonRecord : {};
        const end = row.end && typeof row.end === "object" ? row.end as JsonRecord : {};
        let startDate: Date | null = null;
        let endDate: Date | null = null;
        if (typeof start.dateTime === "string" && typeof end.dateTime === "string") {
          startDate = new Date(start.dateTime);
          endDate = new Date(end.dateTime);
        } else if (typeof start.date === "string" && typeof end.date === "string") {
          startDate = calendarDateAtMidnightUtc(start.date, calendarTimeZone);
          endDate = calendarDateAtMidnightUtc(end.date, calendarTimeZone);
        }
        if (startDate && endDate && Number.isFinite(startDate.getTime()) && Number.isFinite(endDate.getTime()) && endDate > startDate) {
          busy.push({ start: startDate, end: endDate });
        }
      }
      pageToken = typeof json.nextPageToken === "string" ? json.nextPageToken : undefined;
    } while (pageToken);
  }
  return busy;
}

export async function listHostBusyIntervals(hostUserId: number, timeMin: Date, timeMax: Date) {
  const calendar = await prisma.consultationHostCalendar.findUnique({ where: { hostUserId } });
  if (!calendar) return [];
  const calendarIds = [...new Set([
    ...calendar.maskCalendarIds,
    ...(calendar.targetCalendarId ? [calendar.targetCalendarId] : []),
  ])];
  if (!calendarIds.length) return [];
  const accessToken = await getGoogleAccessToken(hostUserId);
  if (!accessToken) throw new GoogleCalendarAuthError("Google Calendar connection is incomplete");
  return listBusyCalendarIntervals({ accessToken, calendarIds, timeMin, timeMax });
}

export async function hostCalendarHasConflict(hostUserId: number, startUtc: Date, endUtc: Date) {
  const busy = await listHostBusyIntervals(hostUserId, startUtc, endUtc);
  return busy.some((interval) => startUtc < interval.end && endUtc > interval.start);
}

export async function createGoogleCalendarEvent(options: {
  accessToken: string;
  calendarId: string;
  eventId: string;
  title: string;
  description?: string;
  startUtc: Date;
  endUtc: Date;
  guestEmail: string;
  autoMeet: boolean;
  privateExtendedProperties: Record<string, string>;
}): Promise<{ id: string; meetUrl: string | null }> {
  const body: JsonRecord = {
    id: options.eventId,
    summary: options.title,
    description: options.description,
    start: { dateTime: options.startUtc.toISOString(), timeZone: "UTC" },
    end: { dateTime: options.endUtc.toISOString(), timeZone: "UTC" },
    attendees: [{ email: options.guestEmail }],
    reminders: { useDefault: false, overrides: [{ method: "email", minutes: 60 }, { method: "popup", minutes: 5 }] },
    extendedProperties: { private: options.privateExtendedProperties },
  };
  if (options.autoMeet) {
    body.conferenceData = {
      createRequest: {
        requestId: `spottex-${options.eventId}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }
  const response = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(options.calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`, {
    method: "POST",
    headers: { Authorization: `Bearer ${options.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: googleTimeout(),
  });
  const json = await readJson(response);
  let event = json;
  if (response.status === 409) {
    const existingResponse = await fetch(
      `${CALENDAR_API}/calendars/${encodeURIComponent(options.calendarId)}/events/${encodeURIComponent(options.eventId)}?conferenceDataVersion=1`,
      { headers: { Authorization: `Bearer ${options.accessToken}` }, signal: googleTimeout() },
    );
    event = await readJson(existingResponse);
    const privateProperties = event.extendedProperties && typeof event.extendedProperties === "object"
      ? (event.extendedProperties as JsonRecord).private
      : null;
    const matchesIdentity = privateProperties && typeof privateProperties === "object"
      && Object.entries(options.privateExtendedProperties).every(([key, value]) => (privateProperties as JsonRecord)[key] === value);
    if (!existingResponse.ok || event.status === "cancelled" || !matchesIdentity) {
      throw new Error("Google Calendar event identity conflict");
    }
  } else if (!response.ok) {
    throw new Error("Google Calendar event creation failed");
  }
  if (event.id !== options.eventId) throw new Error("Google Calendar event identity conflict");
  const entries = event.conferenceData && typeof event.conferenceData === "object"
    ? (event.conferenceData as JsonRecord).entryPoints
    : null;
  const video = Array.isArray(entries)
    ? entries.find((entry) => entry && typeof entry === "object" && (entry as JsonRecord).entryPointType === "video") as JsonRecord | undefined
    : undefined;
  return {
    id: event.id,
    meetUrl: typeof event.hangoutLink === "string" ? event.hangoutLink : typeof video?.uri === "string" ? video.uri : null,
  };
}

export async function deleteGoogleCalendarEvent(options: { accessToken: string; calendarId: string; eventId: string }) {
  const response = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(options.calendarId)}/events/${encodeURIComponent(options.eventId)}?sendUpdates=all`,
    { method: "DELETE", headers: { Authorization: `Bearer ${options.accessToken}` }, signal: googleTimeout() },
  );
  if (!response.ok && response.status !== 404 && response.status !== 410) throw new Error("Google Calendar event deletion failed");
}
