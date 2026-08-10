import { JobStatus, ScheduledJob } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class CalendarAuthError extends Error {}
  return {
    createEvent: vi.fn(),
    deleteEvent: vi.fn(),
    getAccessToken: vi.fn(),
    queueMeetReady: vi.fn(),
    slotUpdate: vi.fn(),
    bookingFind: vi.fn(),
    calendarFind: vi.fn(),
    executeRaw: vi.fn(),
    job: null as ScheduledJob | null,
    CalendarAuthError,
  };
});

vi.mock("@/lib/consultation/google-calendar", () => ({
  createGoogleCalendarEvent: mocks.createEvent,
  deleteGoogleCalendarEvent: mocks.deleteEvent,
  getGoogleAccessToken: mocks.getAccessToken,
  GoogleCalendarAuthError: mocks.CalendarAuthError,
}));

vi.mock("@/lib/consultation/service", () => ({
  queueConsultationMeetReady: mocks.queueMeetReady,
}));

vi.mock("@/lib/prisma", () => {
  const transactionClient = {
    $executeRaw: mocks.executeRaw,
    consultationBooking: { findUnique: mocks.bookingFind },
    consultationHostCalendar: {
      findUnique: mocks.calendarFind,
    },
    consultationSlot: {
      updateMany: mocks.slotUpdate.mockResolvedValue({ count: 1 }),
    },
  };
  const applyJobData = (data: Record<string, unknown>) => {
    if (!mocks.job) return;
    if (typeof data.status === "string") mocks.job.status = data.status as JobStatus;
    if (data.lockedAt === null || data.lockedAt instanceof Date) mocks.job.lockedAt = data.lockedAt;
    if (data.completedAt instanceof Date) mocks.job.completedAt = data.completedAt;
    if (data.runAt instanceof Date) mocks.job.runAt = data.runAt;
    if (typeof data.lastError === "string" || data.lastError === null) mocks.job.lastError = data.lastError;
    if (data.attempts && typeof data.attempts === "object" && "increment" in data.attempts) {
      mocks.job.attempts += Number((data.attempts as { increment: number }).increment);
    }
  };
  return {
    prisma: {
      $transaction: vi.fn(async (callback: (tx: typeof transactionClient) => unknown) => callback(transactionClient)),
      scheduledJob: {
        updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          if (!mocks.job || where.id !== mocks.job.id) return { count: 0 };
          if (where.status && where.status !== mocks.job.status) return { count: 0 };
          applyJobData(data);
          return { count: 1 };
        }),
        findMany: vi.fn(async ({ where }: { where: { status: JobStatus; runAt: { lte: Date }; id?: { in: string[] } } }) => {
          if (!mocks.job || mocks.job.status !== where.status || mocks.job.runAt > where.runAt.lte) return [];
          if (where.id && !where.id.in.includes(mocks.job.id)) return [];
          return [{ ...mocks.job }];
        }),
      },
    },
  };
});

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import {
  CALENDAR_CREATE_JOB,
  CALENDAR_DELETE_JOB,
  enqueueCalendarCreate,
  enqueueCalendarDelete,
  googleCalendarEventId,
  processConsultationCalendarJobs,
  resolveCalendarDeleteCalendarId,
} from "./calendar-sync";

describe("consultation calendar durable outbox", () => {
  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    mocks.job = {
      id: "calendar-job-1",
      type: CALENDAR_CREATE_JOB,
      idempotencyKey: "consultation-calendar:create:42:r3",
      payload: {
        version: 2,
        bookingId: 42,
        slotId: 81,
        revision: 3,
        encryptedTarget: encryptSecret(JSON.stringify({
          calendarId: "snapshot-calendar@example.test",
          autoMeet: true,
        })),
      },
      status: JobStatus.PENDING,
      runAt: new Date("2026-07-14T10:00:00Z"),
      attempts: 0,
      lockedAt: null,
      lastError: null,
      completedAt: null,
      createdAt: new Date("2026-07-14T09:59:00Z"),
      updatedAt: new Date("2026-07-14T09:59:00Z"),
    };
    mocks.createEvent.mockReset();
    mocks.deleteEvent.mockReset();
    mocks.getAccessToken.mockReset().mockResolvedValue("access-token");
    mocks.queueMeetReady.mockReset().mockResolvedValue(undefined);
    mocks.executeRaw.mockReset().mockResolvedValue(1);
    mocks.bookingFind.mockReset().mockResolvedValue({
      id: 42,
      status: "CONFIRMED",
      slotId: 81,
      calendarRevision: 3,
      guestName: "Test guest",
      guestEmail: "guest@example.test",
      note: null,
      slot: {
        id: 81,
        hostUserId: 9,
        startUtc: new Date("2026-07-20T08:00:00Z"),
        endUtc: new Date("2026-07-20T08:30:00Z"),
      },
    });
    mocks.calendarFind.mockReset().mockResolvedValue({ targetCalendarId: "calendar@example.test", autoMeet: true });
    mocks.slotUpdate.mockReset().mockResolvedValue({ count: 1 });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("backs off after failure and retries with the same deterministic event identity", async () => {
    mocks.createEvent
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValueOnce({ id: googleCalendarEventId(42, 3), meetUrl: "https://meet.google.com/abc-defg-hij" });

    const firstResult = await processConsultationCalendarJobs({
      jobIds: ["calendar-job-1"],
      now: new Date("2026-07-14T10:00:00Z"),
    });
    expect(mocks.createEvent, JSON.stringify(firstResult)).toHaveBeenCalledTimes(1);
    expect(firstResult).toMatchObject({ processed: 1, retried: 1, succeeded: 0 });
    expect(mocks.job).toMatchObject({ status: JobStatus.PENDING, attempts: 1, lastError: "Google Calendar synchronization failed" });
    expect(mocks.job?.runAt).toEqual(new Date("2026-07-14T10:00:30Z"));

    await expect(processConsultationCalendarJobs({
      jobIds: ["calendar-job-1"],
      now: new Date("2026-07-14T10:00:31Z"),
    })).resolves.toMatchObject({ processed: 1, retried: 0, succeeded: 1 });
    expect(mocks.job).toMatchObject({ status: JobStatus.SUCCEEDED, attempts: 2, lastError: null });
    expect(mocks.createEvent).toHaveBeenCalledTimes(2);
    expect(mocks.createEvent.mock.calls[0]?.[0].eventId).toBe(googleCalendarEventId(42, 3));
    expect(mocks.createEvent.mock.calls[1]?.[0].eventId).toBe(googleCalendarEventId(42, 3));
    expect(mocks.createEvent.mock.calls[0]?.[0]).toMatchObject({
      calendarId: "snapshot-calendar@example.test",
      autoMeet: true,
    });
    expect(mocks.createEvent.mock.calls[1]?.[0]).toMatchObject({
      calendarId: "snapshot-calendar@example.test",
      autoMeet: true,
    });
    expect(mocks.calendarFind).not.toHaveBeenCalled();
    expect(mocks.slotUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.queueMeetReady).toHaveBeenCalledTimes(1);
    expect(mocks.queueMeetReady).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 42,
      revision: 3,
      meetUrl: "https://meet.google.com/abc-defg-hij",
    }));
  });

  it("encrypts an immutable CREATE destination and Meet setting at enqueue time", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "create-job" });
    await enqueueCalendarCreate({ scheduledJob: { upsert } } as never, {
      bookingId: 42,
      slotId: 81,
      revision: 3,
      calendarId: "private-create@example.test",
      autoMeet: false,
      runAt: new Date("2026-07-14T10:00:00Z"),
    });

    const create = upsert.mock.calls[0]?.[0].create;
    const serializedPayload = JSON.stringify(create.payload);
    expect(create.payload.version).toBe(2);
    expect(serializedPayload).not.toContain("private-create@example.test");
    expect(decryptSecret(create.payload.encryptedTarget)).toBe(JSON.stringify({
      calendarId: "private-create@example.test",
      autoMeet: false,
    }));
  });

  it("encrypts DELETE calendar/event targets while preserving them for the retry worker", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "delete-job" });
    await enqueueCalendarDelete({ scheduledJob: { upsert } } as never, {
      bookingId: 42,
      hostUserId: 9,
      revision: 3,
      calendarId: "private-host@example.test",
      eventId: "spott0123456789abcdef",
      runAt: new Date("2026-07-14T10:00:00Z"),
    });

    const create = upsert.mock.calls[0]?.[0].create;
    const serializedPayload = JSON.stringify(create.payload);
    expect(serializedPayload).not.toContain("private-host@example.test");
    expect(serializedPayload).not.toContain("spott0123456789abcdef");
    const decrypted = JSON.parse(decryptSecret(create.payload.encryptedTarget));
    expect(decrypted).toEqual({
      calendarId: "private-host@example.test",
      eventId: "spott0123456789abcdef",
    });
  });

  it("uses the original CREATE snapshot for reschedule cleanup after the admin changes target", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      type: CALENDAR_CREATE_JOB,
      payload: {
        version: 2,
        bookingId: 42,
        slotId: 81,
        revision: 3,
        encryptedTarget: encryptSecret(JSON.stringify({
          calendarId: "original-calendar@example.test",
          autoMeet: true,
        })),
      },
    });

    await expect(resolveCalendarDeleteCalendarId(
      { scheduledJob: { findUnique } } as never,
      {
        bookingId: 42,
        revision: 3,
        slotCalendarId: null,
        currentTargetCalendarId: "new-calendar@example.test",
      },
    )).resolves.toBe("original-calendar@example.test");
    expect(findUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: "consultation-calendar:create:42:r3" },
      select: { type: true, payload: true },
    });
  });

  it("does not let cancel fall back to a newly configured target when CREATE snapshot had no target", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      type: CALENDAR_CREATE_JOB,
      payload: {
        version: 2,
        bookingId: 42,
        slotId: 81,
        revision: 3,
        encryptedTarget: encryptSecret(JSON.stringify({ calendarId: null, autoMeet: false })),
      },
    });

    await expect(resolveCalendarDeleteCalendarId(
      { scheduledJob: { findUnique } } as never,
      {
        bookingId: 42,
        revision: 3,
        slotCalendarId: null,
        currentTargetCalendarId: "new-calendar@example.test",
      },
    )).resolves.toBeNull();
  });

  it("prefers a calendar already persisted on the slot without reading the outbox", async () => {
    const findUnique = vi.fn();

    await expect(resolveCalendarDeleteCalendarId(
      { scheduledJob: { findUnique } } as never,
      {
        bookingId: 42,
        revision: 3,
        slotCalendarId: "persisted-slot-calendar@example.test",
        currentTargetCalendarId: "new-calendar@example.test",
      },
    )).resolves.toBe("persisted-slot-calendar@example.test");
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("retries an idempotent DELETE from cancellation or rescheduling after Google fails", async () => {
    if (!mocks.job) throw new Error("missing fixture");
    mocks.job.type = CALENDAR_DELETE_JOB;
    mocks.job.idempotencyKey = "consultation-calendar:delete:42:r3:target";
    mocks.job.payload = {
      version: 1,
      bookingId: 42,
      hostUserId: 9,
      revision: 3,
      encryptedTarget: encryptSecret(JSON.stringify({
        calendarId: "private-host@example.test",
        eventId: "spott0123456789abcdef",
      })),
    };
    mocks.deleteEvent
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValueOnce(undefined);

    await expect(processConsultationCalendarJobs({
      jobIds: [mocks.job.id],
      now: new Date("2026-07-14T10:00:00Z"),
    })).resolves.toMatchObject({ processed: 1, retried: 1, succeeded: 0 });
    await expect(processConsultationCalendarJobs({
      jobIds: [mocks.job.id],
      now: new Date("2026-07-14T10:00:31Z"),
    })).resolves.toMatchObject({ processed: 1, retried: 0, succeeded: 1 });

    expect(mocks.deleteEvent).toHaveBeenCalledTimes(2);
    expect(mocks.deleteEvent).toHaveBeenNthCalledWith(1, {
      accessToken: "access-token",
      calendarId: "private-host@example.test",
      eventId: "spott0123456789abcdef",
    });
    expect(mocks.deleteEvent).toHaveBeenNthCalledWith(2, {
      accessToken: "access-token",
      calendarId: "private-host@example.test",
      eventId: "spott0123456789abcdef",
    });
  });
});
