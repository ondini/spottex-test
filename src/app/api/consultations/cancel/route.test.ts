import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeRateLimit: vi.fn(),
  bookingLookup: vi.fn(),
  currentBooking: vi.fn(),
  bookingUpdate: vi.fn(),
  slotUpdate: vi.fn(),
  calendarFind: vi.fn(),
  resolveDeleteCalendar: vi.fn(),
  enqueueDelete: vi.fn(),
  processJobs: vi.fn(),
  cancelReminders: vi.fn(),
  lockCalendar: vi.fn(),
  executeRaw: vi.fn(),
}));

vi.mock("@/lib/security/rate-limit", () => ({ consumeRateLimit: mocks.consumeRateLimit }));
vi.mock("@/lib/consultation/calendar-state", () => ({ lockHostCalendarState: mocks.lockCalendar }));
vi.mock("@/lib/consultation/service", () => ({ cancelPendingConsultationReminders: mocks.cancelReminders }));
vi.mock("@/lib/consultation/calendar-sync", () => ({
  enqueueCalendarDelete: mocks.enqueueDelete,
  googleCalendarEventId: (bookingId: number, revision: number) => `stable-${bookingId}-r${revision}`,
  processConsultationCalendarJobs: mocks.processJobs,
  resolveCalendarDeleteCalendarId: mocks.resolveDeleteCalendar,
}));
vi.mock("@/lib/prisma", () => {
  const tx = {
    $executeRaw: mocks.executeRaw,
    consultationBooking: {
      findUniqueOrThrow: mocks.currentBooking,
      updateMany: mocks.bookingUpdate,
    },
    consultationSlot: { updateMany: mocks.slotUpdate },
    consultationHostCalendar: { findUnique: mocks.calendarFind },
  };
  return {
    prisma: {
      consultationBooking: { findUnique: mocks.bookingLookup },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    },
  };
});

import { POST } from "./route";

describe("consultation cancellation calendar cleanup", () => {
  beforeEach(() => {
    const startUtc = new Date(Date.now() + 4 * 60 * 60_000);
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.bookingLookup.mockResolvedValue({ id: 42, slot: { hostUserId: 9 } });
    mocks.currentBooking.mockResolvedValue({
      id: 42,
      slotId: 81,
      status: "CONFIRMED",
      calendarRevision: 3,
      manageTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60_000),
      slot: {
        id: 81,
        hostUserId: 9,
        status: "BOOKED",
        startUtc,
        googleCalendarId: null,
        googleEventId: null,
      },
    });
    mocks.bookingUpdate.mockResolvedValue({ count: 1 });
    mocks.slotUpdate.mockResolvedValue({ count: 1 });
    mocks.calendarFind.mockResolvedValue({ targetCalendarId: "new-calendar@example.test" });
    mocks.resolveDeleteCalendar.mockResolvedValue("original-calendar@example.test");
    mocks.enqueueDelete.mockResolvedValue({ id: "delete-job" });
    mocks.processJobs.mockResolvedValue({ succeeded: 1 });
    mocks.cancelReminders.mockResolvedValue(undefined);
    mocks.lockCalendar.mockResolvedValue({ id: 1, metadata: {} });
    mocks.executeRaw.mockResolvedValue(1);
  });

  it("enqueues DELETE against the CREATE snapshot rather than the current admin target", async () => {
    const request = new NextRequest("https://spottex.example.test/api/consultations/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "valid-manage-token-at-least-twenty-characters" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.resolveDeleteCalendar).toHaveBeenCalledWith(expect.anything(), {
      bookingId: 42,
      revision: 3,
      slotCalendarId: null,
      currentTargetCalendarId: "new-calendar@example.test",
    });
    expect(mocks.enqueueDelete).toHaveBeenCalledWith(expect.anything(), {
      bookingId: 42,
      hostUserId: 9,
      revision: 3,
      calendarId: "original-calendar@example.test",
      eventId: "stable-42-r3",
    });
  });
});
