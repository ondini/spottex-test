import { afterEach, describe, expect, it, vi } from "vitest";

import { createGoogleCalendarEvent, listBusyCalendarIntervals, revokeGoogleCalendarGrant } from "./google-calendar";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("Google Calendar busy intervals", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fails closed when any configured calendar cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "unavailable" }, 503)));

    await expect(listBusyCalendarIntervals({
      accessToken: "token",
      calendarIds: ["calendar@example.test"],
      timeMin: new Date("2026-07-13T00:00:00Z"),
      timeMax: new Date("2026-07-20T00:00:00Z"),
    })).rejects.toThrow("Google Calendar busy check failed (503)");
  });

  it("reads every page and maps one-day all-day events in the calendar timezone", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        timeZone: "Europe/Prague",
        nextPageToken: "page-2",
        items: [{ status: "confirmed", start: { date: "2026-07-14" }, end: { date: "2026-07-15" } }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        timeZone: "Europe/Prague",
        items: [{ status: "confirmed", start: { dateTime: "2026-07-16T10:00:00+02:00" }, end: { dateTime: "2026-07-16T10:30:00+02:00" } }],
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await listBusyCalendarIntervals({
      accessToken: "token",
      calendarIds: ["calendar@example.test"],
      timeMin: new Date("2026-07-13T00:00:00Z"),
      timeMax: new Date("2026-07-20T00:00:00Z"),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("pageToken=page-2");
    expect(result).toEqual([
      { start: new Date("2026-07-13T22:00:00.000Z"), end: new Date("2026-07-14T22:00:00.000Z") },
      { start: new Date("2026-07-16T08:00:00.000Z"), end: new Date("2026-07-16T08:30:00.000Z") },
    ]);
  });
});

describe("Google Calendar idempotent event creation", () => {
  afterEach(() => vi.unstubAllGlobals());

  const options = {
    accessToken: "access-token",
    calendarId: "calendar@example.test",
    eventId: "spott0123456789abcdef",
    title: "Spottex consultation",
    startUtc: new Date("2026-07-20T08:00:00Z"),
    endUtc: new Date("2026-07-20T08:30:00Z"),
    guestEmail: "guest@example.test",
    autoMeet: true,
    privateExtendedProperties: {
      spottexBookingId: "42",
      spottexCalendarRevision: "3",
    },
  };

  it("recovers a prior successful insert after a retry receives HTTP 409", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "duplicate" }, 409))
      .mockResolvedValueOnce(jsonResponse({
        id: options.eventId,
        status: "confirmed",
        hangoutLink: "https://meet.google.com/test-link",
        extendedProperties: { private: options.privateExtendedProperties },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createGoogleCalendarEvent(options)).resolves.toEqual({
      id: options.eventId,
      meetUrl: "https://meet.google.com/test-link",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const insert = fetchMock.mock.calls[0];
    const body = JSON.parse(String((insert?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({
      id: options.eventId,
      extendedProperties: { private: options.privateExtendedProperties },
      conferenceData: { createRequest: { requestId: `spottex-${options.eventId}` } },
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(`/events/${options.eventId}`);
  });

  it("rejects a 409 event whose private identity belongs to another booking", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "duplicate" }, 409))
      .mockResolvedValueOnce(jsonResponse({
        id: options.eventId,
        status: "confirmed",
        extendedProperties: { private: { ...options.privateExtendedProperties, spottexBookingId: "other" } },
      })));

    await expect(createGoogleCalendarEvent(options)).rejects.toThrow("Google Calendar event identity conflict");
  });
});

describe("Google Calendar grant revocation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("treats an invalid or already revoked provider token as locally disconnectable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(revokeGoogleCalendarGrant("already-revoked-refresh-token"))
      .resolves.toBe("ALREADY_REVOKED");
    expect(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)).toContain("token=already-revoked-refresh-token");
  });

  it("keeps a real provider or network failure distinguishable from an invalid grant", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    await expect(revokeGoogleCalendarGrant("refresh-token")).rejects.toThrow("Google grant revocation failed (503)");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));
    await expect(revokeGoogleCalendarGrant("refresh-token")).rejects.toThrow("network down");
  });
});
