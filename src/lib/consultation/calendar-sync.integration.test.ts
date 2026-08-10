import { randomUUID } from "node:crypto";

import { JobStatus, UserStatus } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

import {
  enqueueCalendarCreate,
  processConsultationCalendarJobs,
} from "./calendar-sync";
import { decryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

const databaseDescribe = process.env.RUN_DB_INTEGRATION_TESTS === "true" ? describe : describe.skip;

databaseDescribe("consultation calendar PostgreSQL outbox integration", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("commits the booking mutation and one idempotent job atomically", async () => {
    const suffix = randomUUID();
    const fixture = await prisma.$transaction(async (tx) => {
      const host = await tx.user.create({
        data: {
          email: `calendar-outbox-${suffix}@example.test`,
          passwordHash: "not-a-login-password",
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      });
      const startUtc = new Date(Date.now() + 7 * 86_400_000);
      const slot = await tx.consultationSlot.create({
        data: {
          hostUserId: host.id,
          startUtc,
          endUtc: new Date(startUtc.getTime() + 30 * 60_000),
          status: "HELD",
          holdExpiresAt: new Date(Date.now() + 30 * 60_000),
        },
      });
      const booking = await tx.consultationBooking.create({
        data: {
          slotId: slot.id,
          guestEmail: `calendar-guest-${suffix}@example.test`,
          status: "PENDING",
          manageTokenHash: `manage-${suffix}`,
          manageTokenExpiresAt: new Date(startUtc.getTime() + 7 * 86_400_000),
          verifyTokenHash: `verify-${suffix}`,
        },
      });
      return { hostUserId: host.id, slotId: slot.id, bookingId: booking.id };
    });
    const idempotencyKey = `consultation-calendar:create:${fixture.bookingId}:r1`;

    try {
      await expect(prisma.$transaction(async (tx) => {
        await tx.consultationBooking.update({
          where: { id: fixture.bookingId },
          data: { status: "CONFIRMED", calendarRevision: { increment: 1 } },
        });
        await enqueueCalendarCreate(tx, {
          bookingId: fixture.bookingId,
          slotId: fixture.slotId,
          revision: 1,
          calendarId: null,
          autoMeet: true,
        });
        throw new Error("ROLLBACK_TEST");
      })).rejects.toThrow("ROLLBACK_TEST");
      await expect(prisma.consultationBooking.findUniqueOrThrow({ where: { id: fixture.bookingId } }))
        .resolves.toMatchObject({ status: "PENDING", calendarRevision: 0 });
      await expect(prisma.scheduledJob.count({ where: { idempotencyKey } })).resolves.toBe(0);

      const job = await prisma.$transaction(async (tx) => {
        await tx.consultationBooking.update({
          where: { id: fixture.bookingId },
          data: { status: "CONFIRMED", calendarRevision: { increment: 1 } },
        });
        await tx.consultationSlot.update({
          where: { id: fixture.slotId },
          data: { status: "BOOKED", holdExpiresAt: null },
        });
        return enqueueCalendarCreate(tx, {
          bookingId: fixture.bookingId,
          slotId: fixture.slotId,
          revision: 1,
          calendarId: null,
          autoMeet: true,
        });
      });
      const duplicate = await prisma.$transaction((tx) => enqueueCalendarCreate(tx, {
        bookingId: fixture.bookingId,
        slotId: fixture.slotId,
        revision: 1,
        calendarId: "changed-after-enqueue@example.test",
        autoMeet: false,
      }));
      expect(duplicate.id).toBe(job.id);
      await expect(prisma.scheduledJob.count({ where: { idempotencyKey } })).resolves.toBe(1);
      const persistedPayload = (await prisma.scheduledJob.findUniqueOrThrow({ where: { id: job.id } })).payload as {
        encryptedTarget: string;
      };
      expect(JSON.parse(decryptSecret(persistedPayload.encryptedTarget))).toEqual({
        calendarId: null,
        autoMeet: true,
      });

      await expect(processConsultationCalendarJobs({
        jobIds: [job.id],
        now: new Date(Date.now() + 1_000),
        limit: 1,
      })).resolves.toMatchObject({ processed: 1, succeeded: 1, retried: 0 });
      await expect(prisma.scheduledJob.findUniqueOrThrow({ where: { id: job.id } }))
        .resolves.toMatchObject({ status: JobStatus.SUCCEEDED, attempts: 1 });
      await expect(processConsultationCalendarJobs({
        jobIds: [job.id],
        now: new Date(Date.now() + 2_000),
        limit: 1,
      })).resolves.toMatchObject({ processed: 0, succeeded: 0 });
    } finally {
      await prisma.scheduledJob.deleteMany({ where: { idempotencyKey } });
      await prisma.consultationBooking.deleteMany({ where: { id: fixture.bookingId } });
      await prisma.consultationSlot.deleteMany({ where: { id: fixture.slotId } });
      await prisma.user.deleteMany({ where: { id: fixture.hostUserId } });
    }
  }, 20_000);
});
