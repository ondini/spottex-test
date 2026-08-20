import { randomUUID } from "node:crypto";

import {
  EnergyProvider,
  EnergySiteStatus,
  InverterStatus,
  JobStatus,
  ProductType,
  SubscriptionSource,
  SubscriptionStatus,
  UserStatus,
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";

import {
  enqueueInverterDeactivationJob,
  processInverterDeactivationJobs,
} from "./deactivation-jobs";

vi.mock("server-only", () => ({}));

const databaseDescribe =
  process.env.RUN_DB_INTEGRATION_TESTS === "true" ? describe : describe.skip;
const originalAuthSecret = process.env.AUTH_SECRET;

type Fixture = {
  userId: number;
  siteId: number;
  inverterId: number;
  subscriptionId: string | null;
  jobIds: string[];
};

async function createFixture(input: {
  entitled?: boolean;
  provider?: EnergyProvider;
} = {}): Promise<Fixture> {
  const suffix = `energy-job-it-${randomUUID()}`;
  await prisma.product.createMany({
    data: [{
      code: "INVERTER_CONTROL",
      name: "Řízení střídače",
      type: ProductType.SUBSCRIPTION,
      priceMinor: 0,
      billingPeriodDays: 30,
      metadata: { integrationTestBootstrap: true },
    }],
    skipDuplicates: true,
  });
  const product = await prisma.product.findUniqueOrThrow({
    where: { code: "INVERTER_CONTROL" },
  });
  const user = await prisma.user.create({
    data: {
      email: `${suffix}@example.test`,
      passwordHash: "not-a-login-password",
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
  });
  const provider = input.provider ?? EnergyProvider.DEMO;
  const site = await prisma.energySite.create({
    data: {
      userId: user.id,
      provider,
      externalSiteId: `${suffix}-site`,
      name: "Durable deactivation site",
      status: EnergySiteStatus.ONLINE,
      // Intentionally false: the physical OFF command must not trust this cache.
      optimizationOn: false,
      requiredInfo: false,
      inverters: {
        create: {
          provider,
          externalDeviceId: `${suffix}-inverter`,
          name: "Durable deactivation inverter",
          status: InverterStatus.ONLINE,
        },
      },
    },
    include: { inverters: true },
  });
  const subscription = input.entitled
    ? await prisma.subscription.create({
        data: {
          userId: user.id,
          productId: product.id,
          status: SubscriptionStatus.ACTIVE,
          source: SubscriptionSource.PROMO,
          startsAt: new Date(Date.now() - 60_000),
          endsAt: new Date(Date.now() + 86_400_000),
        },
      })
    : null;
  return {
    userId: user.id,
    siteId: site.id,
    inverterId: site.inverters[0].id,
    subscriptionId: subscription?.id ?? null,
    jobIds: [],
  };
}

async function cleanupFixture(fixture: Fixture | null) {
  if (!fixture) return;
  await prisma.scheduledJob.deleteMany({ where: { id: { in: fixture.jobIds } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: fixture.userId } });
  await prisma.energySite.deleteMany({ where: { id: fixture.siteId } });
  await prisma.subscription.deleteMany({ where: { userId: fixture.userId } });
  await prisma.user.deleteMany({ where: { id: fixture.userId } });
}

databaseDescribe("durable inverter deactivation outbox", () => {
  beforeAll(() => {
    if (!process.env.AUTH_SECRET) {
      process.env.AUTH_SECRET = "energy-job-integration-secret-at-least-32-characters";
    }
  });

  afterAll(() => {
    if (originalAuthSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = originalAuthSecret;
  });

  it("commits cancellation and outbox atomically, recovers a crashed claim, and sends OFF despite a false local cache", async () => {
    let fixture: Fixture | null = null;
    try {
      fixture = await createFixture({ entitled: true });
      const idempotencyKey = `subscription-cancel:${fixture.subscriptionId}`;

      await expect(prisma.$transaction(async (tx) => {
        await tx.subscription.update({
          where: { id: fixture?.subscriptionId ?? "missing" },
          data: { status: SubscriptionStatus.CANCELED, canceledAt: new Date(), endsAt: new Date() },
        });
        await enqueueInverterDeactivationJob(tx, {
          userId: fixture?.userId ?? 0,
          reason: "rollback-regression",
          idempotencyKey,
        });
        throw new Error("SIMULATED_CRASH_BEFORE_COMMIT");
      })).rejects.toThrow("SIMULATED_CRASH_BEFORE_COMMIT");
      await expect(prisma.subscription.findUniqueOrThrow({
        where: { id: fixture.subscriptionId ?? "missing" },
      })).resolves.toMatchObject({ status: SubscriptionStatus.ACTIVE });

      const job = await prisma.$transaction(async (tx) => {
        await tx.subscription.update({
          where: { id: fixture?.subscriptionId ?? "missing" },
          data: { status: SubscriptionStatus.CANCELED, canceledAt: new Date(), endsAt: new Date() },
        });
        return enqueueInverterDeactivationJob(tx, {
          userId: fixture?.userId ?? 0,
          reason: "committed-cancel",
          idempotencyKey,
        });
      });
      fixture.jobIds.push(job.id);
      expect(job.status).toBe(JobStatus.PENDING);

      const now = new Date();
      await prisma.scheduledJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.RUNNING,
          lockedAt: new Date(now.getTime() - 11 * 60_000),
          lastError: "worker-that-crashed",
        },
      });
      await expect(processInverterDeactivationJobs({
        jobIds: [job.id],
        now,
        limit: 1,
      })).resolves.toMatchObject({ recovered: 1, processed: 1, succeeded: 1, retried: 0 });
      await expect(prisma.scheduledJob.findUniqueOrThrow({ where: { id: job.id } }))
        .resolves.toMatchObject({ status: JobStatus.SUCCEEDED, attempts: 1 });
      await expect(prisma.inverterCommand.count({
        where: {
          inverterId: fixture.inverterId,
          type: "turnoff",
          status: "ACKNOWLEDGED",
        },
      })).resolves.toBe(1);
    } finally {
      await cleanupFixture(fixture);
    }
  }, 20_000);

  it("keeps an unconfirmed physical OFF pending with backoff and succeeds on a later retry", async () => {
    let fixture: Fixture | null = null;
    try {
      fixture = await createFixture({ provider: EnergyProvider.LEGACY_SPOTTEX });
      const firstRun = new Date();
      const job = await enqueueInverterDeactivationJob(prisma, {
        userId: fixture.userId,
        reason: "provider-retry-regression",
        idempotencyKey: `provider-retry:${randomUUID()}`,
        runAt: new Date(firstRun.getTime() - 1_000),
      });
      fixture.jobIds.push(job.id);

      await expect(processInverterDeactivationJobs({
        jobIds: [job.id],
        now: firstRun,
        limit: 1,
      })).resolves.toMatchObject({ processed: 1, succeeded: 0, retried: 1 });
      await expect(prisma.scheduledJob.findUniqueOrThrow({ where: { id: job.id } }))
        .resolves.toMatchObject({ status: JobStatus.PENDING, attempts: 1 });

      await prisma.$transaction([
        prisma.energySite.update({
          where: { id: fixture.siteId },
          data: { provider: EnergyProvider.DEMO },
        }),
        prisma.inverter.update({
          where: { id: fixture.inverterId },
          data: { provider: EnergyProvider.DEMO },
        }),
      ]);
      await expect(processInverterDeactivationJobs({
        jobIds: [job.id],
        now: new Date(firstRun.getTime() + 31_000),
        limit: 1,
      })).resolves.toMatchObject({ processed: 1, succeeded: 1, retried: 0 });
      await expect(prisma.scheduledJob.findUniqueOrThrow({ where: { id: job.id } }))
        .resolves.toMatchObject({ status: JobStatus.SUCCEEDED, attempts: 2 });
    } finally {
      await cleanupFixture(fixture);
    }
  }, 20_000);

  it("turns a disabled user off even if an ACTIVE subscription remains", async () => {
    let fixture: Fixture | null = null;
    try {
      fixture = await createFixture({ entitled: true });
      await prisma.user.update({
        where: { id: fixture.userId },
        data: { status: UserStatus.DISABLED },
      });
      const job = await enqueueInverterDeactivationJob(prisma, {
        userId: fixture.userId,
        reason: "user-disabled",
        idempotencyKey: `user-disabled:${fixture.userId}`,
      });
      fixture.jobIds.push(job.id);

      await expect(processInverterDeactivationJobs({ jobIds: [job.id], limit: 1 }))
        .resolves.toMatchObject({ succeeded: 1, noOp: 0 });
      await expect(prisma.inverterCommand.count({
        where: { inverterId: fixture.inverterId, type: "turnoff", status: "ACKNOWLEDGED" },
      })).resolves.toBe(1);
    } finally {
      await cleanupFixture(fixture);
    }
  }, 20_000);

  it("confirms OFF on every controllable inverter before a multi-device job succeeds", async () => {
    let fixture: Fixture | null = null;
    try {
      fixture = await createFixture();
      const second = await prisma.inverter.create({
        data: {
          energySiteId: fixture.siteId,
          provider: EnergyProvider.DEMO,
          externalDeviceId: `second-${randomUUID()}`,
          name: "Second controllable inverter",
          status: InverterStatus.ONLINE,
        },
      });
      const job = await enqueueInverterDeactivationJob(prisma, {
        userId: fixture.userId,
        reason: "multi-inverter-deactivation",
        idempotencyKey: `multi-inverter:${fixture.userId}`,
      });
      fixture.jobIds.push(job.id);

      const result = await processInverterDeactivationJobs({ jobIds: [job.id], limit: 1 });
      expect(result).toMatchObject({ succeeded: 1, retried: 0 });
      expect(result.outcomes).toContainEqual(expect.objectContaining({
        jobId: job.id,
        status: "SUCCEEDED",
        attempted: 2,
        failed: 0,
      }));
      const commands = await prisma.inverterCommand.findMany({
        where: {
          inverterId: { in: [fixture.inverterId, second.id] },
          type: "turnoff",
          status: "ACKNOWLEDGED",
        },
        select: { inverterId: true },
      });
      expect(new Set(commands.map((command) => command.inverterId)))
        .toEqual(new Set([fixture.inverterId, second.id]));
      await expect(prisma.scheduledJob.findUniqueOrThrow({ where: { id: job.id } }))
        .resolves.toMatchObject({ status: JobStatus.SUCCEEDED });
    } finally {
      await cleanupFixture(fixture);
    }
  }, 20_000);

  it("completes successfully for a user who has no connected site", async () => {
    let fixture: Fixture | null = null;
    try {
      fixture = await createFixture();
      await prisma.energySite.delete({ where: { id: fixture.siteId } });
      const job = await enqueueInverterDeactivationJob(prisma, {
        userId: fixture.userId,
        reason: "no-connected-site",
        idempotencyKey: `no-site:${fixture.userId}`,
      });
      fixture.jobIds.push(job.id);

      const result = await processInverterDeactivationJobs({ jobIds: [job.id], limit: 1 });
      expect(result).toMatchObject({ succeeded: 1, retried: 0 });
      expect(result.outcomes).toContainEqual(expect.objectContaining({
        jobId: job.id,
        status: "SUCCEEDED",
        attempted: 0,
        failed: 0,
      }));
      await expect(prisma.scheduledJob.findUniqueOrThrow({ where: { id: job.id } }))
        .resolves.toMatchObject({ status: JobStatus.SUCCEEDED });
    } finally {
      await cleanupFixture(fixture);
    }
  }, 20_000);

  it("does not reuse an older physical ACK for a later deactivation event with the same reason", async () => {
    let fixture: Fixture | null = null;
    try {
      fixture = await createFixture();
      for (const event of ["first", "second"]) {
        const job = await enqueueInverterDeactivationJob(prisma, {
          userId: fixture.userId,
          reason: "admin-user-disabled",
          idempotencyKey: `repeated-disable:${event}:${randomUUID()}`,
        });
        fixture.jobIds.push(job.id);
        await expect(processInverterDeactivationJobs({ jobIds: [job.id], limit: 1 }))
          .resolves.toMatchObject({ succeeded: 1, retried: 0 });
      }
      await expect(prisma.inverterCommand.count({
        where: {
          inverterId: fixture.inverterId,
          type: "turnoff",
          status: "ACKNOWLEDGED",
        },
      })).resolves.toBe(2);
    } finally {
      await cleanupFixture(fixture);
    }
  }, 20_000);

  it("safely no-ops an obsolete cancellation job after entitlement is restored", async () => {
    let fixture: Fixture | null = null;
    try {
      fixture = await createFixture({ entitled: true });
      const job = await enqueueInverterDeactivationJob(prisma, {
        userId: fixture.userId,
        reason: "obsolete-cancellation",
        idempotencyKey: `obsolete-cancellation:${randomUUID()}`,
      });
      fixture.jobIds.push(job.id);

      await expect(processInverterDeactivationJobs({ jobIds: [job.id], limit: 1 }))
        .resolves.toMatchObject({ succeeded: 1, noOp: 1 });
      await expect(prisma.inverterCommand.count({ where: { inverterId: fixture.inverterId } }))
        .resolves.toBe(0);
    } finally {
      await cleanupFixture(fixture);
    }
  }, 20_000);
});
