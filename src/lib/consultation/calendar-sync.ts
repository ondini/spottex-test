import { createHash } from "node:crypto";

import { JobStatus, Prisma, ScheduledJob } from "@prisma/client";
import { z } from "zod";

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import {
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  getGoogleAccessToken,
  GoogleCalendarAuthError,
} from "@/lib/consultation/google-calendar";
import { queueConsultationMeetReady } from "@/lib/consultation/service";
import { prisma } from "@/lib/prisma";

export const CALENDAR_CREATE_JOB = "CONSULTATION_CALENDAR_CREATE";
export const CALENDAR_DELETE_JOB = "CONSULTATION_CALENDAR_DELETE";

const MAX_ATTEMPTS = 16;
const STALE_LOCK_MS = 10 * 60_000;

const createPayloadSchema = z.object({
  version: z.literal(2),
  bookingId: z.number().int().positive(),
  slotId: z.number().int().positive(),
  revision: z.number().int().positive(),
  encryptedTarget: z.string().min(20),
}).strict();

const createTargetSchema = z.object({
  calendarId: z.string().min(1).max(1024).nullable(),
  autoMeet: z.boolean(),
}).strict();

const deletePayloadSchema = z.object({
  version: z.literal(1),
  bookingId: z.number().int().positive(),
  hostUserId: z.number().int().positive(),
  revision: z.number().int().nonnegative(),
  encryptedTarget: z.string().min(20),
}).strict();

const deleteTargetSchema = z.object({
  calendarId: z.string().min(1).max(1024),
  eventId: z.string().min(5).max(1024),
}).strict();

type JobClient = Pick<Prisma.TransactionClient, "scheduledJob">;

export type CalendarCreateSnapshot = z.infer<typeof createTargetSchema>;

export async function loadCalendarCreateSnapshot(
  tx: JobClient,
  input: { bookingId: number; revision: number },
): Promise<CalendarCreateSnapshot | null> {
  if (input.revision <= 0) return null;
  const job = await tx.scheduledJob.findUnique({
    where: { idempotencyKey: `consultation-calendar:create:${input.bookingId}:r${input.revision}` },
    select: { type: true, payload: true },
  });
  if (!job) return null;
  if (job.type !== CALENDAR_CREATE_JOB) throw new Error("Calendar CREATE job identity conflict");
  const payload = createPayloadSchema.parse(job.payload);
  if (payload.bookingId !== input.bookingId || payload.revision !== input.revision) {
    throw new Error("Calendar CREATE job payload identity conflict");
  }
  return createTargetSchema.parse(JSON.parse(decryptSecret(payload.encryptedTarget)));
}

export async function resolveCalendarDeleteCalendarId(
  tx: JobClient,
  input: {
    bookingId: number;
    revision: number;
    slotCalendarId: string | null;
    currentTargetCalendarId: string | null;
  },
): Promise<string | null> {
  if (input.slotCalendarId) return input.slotCalendarId;
  const originalCreate = await loadCalendarCreateSnapshot(tx, input);
  // A present snapshot with calendarId=null intentionally means that the
  // revision never targeted Google. Do not replace it with a later setting.
  return originalCreate ? originalCreate.calendarId : input.currentTargetCalendarId;
}

export function googleCalendarEventId(bookingId: number, revision: number): string {
  const digest = createHash("sha256")
    .update(`spottex-consultation:${bookingId}:${revision}`)
    .digest("hex");
  // Google custom event IDs accept base32hex characters (a-v and 0-9).
  return `spott${digest}`;
}

export async function enqueueCalendarCreate(
  tx: JobClient,
  input: {
    bookingId: number;
    slotId: number;
    revision: number;
    calendarId: string | null;
    autoMeet: boolean;
    runAt?: Date;
  },
) {
  const idempotencyKey = `consultation-calendar:create:${input.bookingId}:r${input.revision}`;
  return tx.scheduledJob.upsert({
    where: { idempotencyKey },
    update: {},
    create: {
      type: CALENDAR_CREATE_JOB,
      idempotencyKey,
      payload: {
        version: 2,
        bookingId: input.bookingId,
        slotId: input.slotId,
        revision: input.revision,
        // Calendar IDs can be email addresses. The selected destination and
        // Meet behavior are an immutable encrypted snapshot for every retry.
        encryptedTarget: encryptSecret(JSON.stringify({
          calendarId: input.calendarId,
          autoMeet: input.autoMeet,
        })),
      },
      runAt: input.runAt || new Date(),
    },
  });
}

export async function enqueueCalendarDelete(
  tx: JobClient,
  input: {
    bookingId: number;
    hostUserId: number;
    revision: number;
    calendarId: string;
    eventId: string;
    runAt?: Date;
  },
) {
  const targetDigest = createHash("sha256")
    .update(`${input.calendarId}\u0000${input.eventId}`)
    .digest("hex")
    .slice(0, 24);
  const idempotencyKey = `consultation-calendar:delete:${input.bookingId}:r${input.revision}:${targetDigest}`;
  return tx.scheduledJob.upsert({
    where: { idempotencyKey },
    update: {},
    create: {
      type: CALENDAR_DELETE_JOB,
      idempotencyKey,
      // Calendar IDs can be email addresses. Encrypt the target so the JSON
      // outbox contains no readable guest or host PII.
      payload: {
        version: 1,
        bookingId: input.bookingId,
        hostUserId: input.hostUserId,
        revision: input.revision,
        encryptedTarget: encryptSecret(JSON.stringify({ calendarId: input.calendarId, eventId: input.eventId })),
      },
      runAt: input.runAt || new Date(),
    },
  });
}

function retryDelayMs(attempt: number): number {
  return Math.min(6 * 60 * 60_000, 30_000 * (2 ** Math.max(0, attempt - 1)));
}

function safeJobError(error: unknown): string {
  if (error instanceof GoogleCalendarAuthError) return "Google Calendar authorization unavailable";
  return "Google Calendar synchronization failed";
}

async function lockBooking(tx: Prisma.TransactionClient, bookingId: number) {
  await tx.$executeRaw`SELECT id FROM consultation.consultation_booking WHERE id = ${bookingId} FOR UPDATE`;
}

async function executeCreateJob(job: Pick<ScheduledJob, "payload">) {
  const payload = createPayloadSchema.parse(job.payload);
  const target = createTargetSchema.parse(JSON.parse(decryptSecret(payload.encryptedTarget)));
  await prisma.$transaction(async (tx) => {
    await lockBooking(tx, payload.bookingId);
    const booking = await tx.consultationBooking.findUnique({
      where: { id: payload.bookingId },
      include: { slot: true },
    });
    if (!booking
      || booking.status !== "CONFIRMED"
      || booking.slotId !== payload.slotId
      || booking.calendarRevision !== payload.revision) {
      return;
    }

    if (!target.calendarId) return;

    const accessToken = await getGoogleAccessToken(booking.slot.hostUserId, tx);
    if (!accessToken) throw new GoogleCalendarAuthError("Google Calendar connection is incomplete");
    const eventId = googleCalendarEventId(booking.id, payload.revision);
    const event = await createGoogleCalendarEvent({
      accessToken,
      calendarId: target.calendarId,
      eventId,
      title: `Spottex konzultace – ${booking.guestName || booking.guestEmail}`,
      description: booking.note || undefined,
      startUtc: booking.slot.startUtc,
      endUtc: booking.slot.endUtc,
      guestEmail: booking.guestEmail,
      autoMeet: target.autoMeet,
      privateExtendedProperties: {
        spottexBookingId: String(booking.id),
        spottexCalendarRevision: String(payload.revision),
      },
    });
    const updated = await tx.consultationSlot.updateMany({
      where: { id: payload.slotId, status: "BOOKED" },
      data: {
        googleCalendarId: target.calendarId,
        googleEventId: event.id,
        meetUrl: event.meetUrl,
      },
    });
    if (!updated.count) throw new Error("Consultation slot changed during calendar synchronization");
    if (event.meetUrl) {
      await queueConsultationMeetReady({
        bookingId: booking.id,
        revision: payload.revision,
        email: booking.guestEmail,
        name: booking.guestName,
        startUtc: booking.slot.startUtc,
        meetUrl: event.meetUrl,
        db: tx,
      });
    }
  }, { maxWait: 5_000, timeout: 30_000 });
}

async function executeDeleteJob(job: Pick<ScheduledJob, "payload">) {
  const payload = deletePayloadSchema.parse(job.payload);
  const target = deleteTargetSchema.parse(JSON.parse(decryptSecret(payload.encryptedTarget)));
  await prisma.$transaction(async (tx) => {
    await lockBooking(tx, payload.bookingId);
    const accessToken = await getGoogleAccessToken(payload.hostUserId, tx);
    if (!accessToken) throw new GoogleCalendarAuthError("Google Calendar connection is incomplete");
    await deleteGoogleCalendarEvent({
      accessToken,
      calendarId: target.calendarId,
      eventId: target.eventId,
    });
  }, { maxWait: 5_000, timeout: 30_000 });
}

async function executeCalendarJob(job: Pick<ScheduledJob, "type" | "payload">) {
  if (job.type === CALENDAR_CREATE_JOB) return executeCreateJob(job);
  if (job.type === CALENDAR_DELETE_JOB) return executeDeleteJob(job);
  throw new Error("Unsupported consultation calendar job");
}

export async function processConsultationCalendarJobs(options: {
  limit?: number;
  jobIds?: string[];
  now?: Date;
} = {}) {
  const now = options.now || new Date();
  const staleBefore = new Date(now.getTime() - STALE_LOCK_MS);
  const typeFilter = { in: [CALENDAR_CREATE_JOB, CALENDAR_DELETE_JOB] };
  const recovered = await prisma.scheduledJob.updateMany({
    where: {
      type: typeFilter,
      status: JobStatus.RUNNING,
      lockedAt: { lt: staleBefore },
      attempts: { lt: MAX_ATTEMPTS },
    },
    data: {
      status: JobStatus.PENDING,
      runAt: now,
      lockedAt: null,
      lastError: "Recovered after an interrupted calendar synchronization",
    },
  });
  await prisma.scheduledJob.updateMany({
    where: {
      type: typeFilter,
      status: JobStatus.RUNNING,
      lockedAt: { lt: staleBefore },
      attempts: { gte: MAX_ATTEMPTS },
    },
    data: {
      status: JobStatus.FAILED,
      lockedAt: null,
      lastError: "Calendar synchronization worker stopped repeatedly",
    },
  });

  const pending = await prisma.scheduledJob.findMany({
    where: {
      type: typeFilter,
      status: JobStatus.PENDING,
      runAt: { lte: now },
      ...(options.jobIds ? { id: { in: options.jobIds } } : {}),
    },
    orderBy: [{ runAt: "asc" }, { createdAt: "asc" }],
    take: Math.min(Math.max(options.limit || 20, 1), 100),
  });

  let succeeded = 0;
  let retried = 0;
  let failed = 0;
  for (const job of pending) {
    const claimed = await prisma.scheduledJob.updateMany({
      where: { id: job.id, status: JobStatus.PENDING },
      data: { status: JobStatus.RUNNING, lockedAt: now, attempts: { increment: 1 } },
    });
    if (!claimed.count) continue;
    const attempt = job.attempts + 1;
    try {
      await executeCalendarJob(job);
      const completed = await prisma.scheduledJob.updateMany({
        where: { id: job.id, status: JobStatus.RUNNING },
        data: {
          status: JobStatus.SUCCEEDED,
          lockedAt: null,
          completedAt: new Date(),
          lastError: null,
        },
      });
      succeeded += completed.count;
    } catch (error) {
      console.error(`Consultation calendar job ${job.id} failed`, error);
      const terminal = attempt >= MAX_ATTEMPTS;
      await prisma.scheduledJob.updateMany({
        where: { id: job.id, status: JobStatus.RUNNING },
        data: {
          status: terminal ? JobStatus.FAILED : JobStatus.PENDING,
          runAt: terminal ? job.runAt : new Date(now.getTime() + retryDelayMs(attempt)),
          lockedAt: null,
          lastError: safeJobError(error),
        },
      });
      if (terminal) failed += 1;
      else retried += 1;
    }
  }

  return {
    recovered: recovered.count,
    processed: pending.length,
    succeeded,
    retried,
    failed,
  };
}
