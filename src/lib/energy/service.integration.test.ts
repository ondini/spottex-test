import { randomUUID } from "node:crypto";

import {
  CommandStatus,
  EnergyProvider,
  EnergySiteStatus,
  InverterStatus,
  ProductType,
  SubscriptionSource,
  SubscriptionStatus,
  UserStatus,
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";

import {
  deactivateInverterControl,
  issueInverterCommand,
  issueSiteControlCommand,
  reconcileEntitledInverterCommands,
} from "./service";

vi.mock("server-only", () => ({}));

const databaseDescribe =
  process.env.RUN_DB_INTEGRATION_TESTS === "true" ? describe : describe.skip;

type Fixture = {
  userId: number;
  siteId: number;
  inverterId: number;
  subscriptionId: string | null;
};

const originalAuthSecret = process.env.AUTH_SECRET;

async function createFixture(entitled: boolean): Promise<Fixture> {
  const suffix = `energy-it-${randomUUID()}`;
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
  const site = await prisma.energySite.create({
    data: {
      userId: user.id,
      provider: EnergyProvider.DEMO,
      externalSiteId: `${suffix}-site`,
      name: "Energy integration site",
      status: EnergySiteStatus.ONLINE,
      optimizationOn: false,
      requiredInfo: false,
      inverters: {
        create: {
          provider: EnergyProvider.DEMO,
          externalDeviceId: `${suffix}-inverter`,
          name: "Energy integration inverter",
          status: InverterStatus.ONLINE,
        },
      },
    },
    include: { inverters: true },
  });
  const subscription = entitled
    ? await prisma.subscription.create({
        data: {
          userId: user.id,
          productId: product.id,
          status: SubscriptionStatus.ACTIVE,
          source: SubscriptionSource.PROMO,
          startsAt: new Date(Date.now() - 60_000),
          endsAt: new Date(Date.now() + 24 * 60 * 60_000),
        },
      })
    : null;
  return {
    userId: user.id,
    siteId: site.id,
    inverterId: site.inverters[0].id,
    subscriptionId: subscription?.id ?? null,
  };
}

async function cleanupFixture(fixture: Fixture | null): Promise<void> {
  if (!fixture) return;
  await prisma.auditLog.deleteMany({ where: { actorUserId: fixture.userId } });
  await prisma.energySite.deleteMany({ where: { id: fixture.siteId } });
  await prisma.subscription.deleteMany({ where: { userId: fixture.userId } });
  await prisma.user.deleteMany({ where: { id: fixture.userId } });
}

async function waitForHeldInverterLock(
  inverterId: number,
  commandIdempotencyKey: string,
): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const command = await prisma.inverterCommand.findUnique({
      where: { idempotencyKey: commandIdempotencyKey },
      select: { status: true },
    });
    if (command?.status === CommandStatus.PENDING) {
      const [lock] = await prisma.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(74291::int, ${inverterId}::int) AS locked
      `;
      if (!lock.locked) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Per-inverter lock nebyl během vendor volání pozorován.");
}

databaseDescribe("inverter command safety integration", () => {
  beforeAll(() => {
    if (!process.env.AUTH_SECRET) process.env.AUTH_SECRET = "energy-integration-secret-at-least-32-characters";
  });

  afterAll(() => {
    if (originalAuthSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = originalAuthSecret;
  });

  it("reconciles a durable PENDING turnon with the same idempotency key", async () => {
    let fixture: Fixture | null = null;
    try {
      fixture = await createFixture(true);
      const idempotencyKey = `energy-recover-${randomUUID()}`;
      const pending = await prisma.inverterCommand.create({
        data: {
          inverterId: fixture.inverterId,
          requestedById: fixture.userId,
          idempotencyKey,
          type: "turnon",
          payload: { siteId: fixture.siteId },
          status: CommandStatus.PENDING,
        },
      });

      const result = await issueInverterCommand({
        userId: fixture.userId,
        siteId: fixture.siteId,
        type: "turnon",
        idempotencyKey,
      });

      expect(result).toMatchObject({
        id: pending.id,
        status: CommandStatus.ACKNOWLEDGED,
        repeated: true,
      });
      await expect(
        prisma.energySite.findUniqueOrThrow({ where: { id: fixture.siteId } }),
      ).resolves.toMatchObject({ optimizationOn: true });
      await expect(
        prisma.auditLog.count({
          where: {
            action: "INVERTER_COMMAND_RECONCILED",
            entityType: "InverterCommand",
            entityId: pending.id,
          },
        }),
      ).resolves.toBe(1);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("compensates an unresolved turnon instead of hiding it as FAILED after entitlement expiry", async () => {
    let fixture: Fixture | null = null;
    try {
      fixture = await createFixture(false);
      const idempotencyKey = `energy-expired-${randomUUID()}`;
      const pending = await prisma.inverterCommand.create({
        data: {
          inverterId: fixture.inverterId,
          requestedById: fixture.userId,
          idempotencyKey,
          type: "turnon",
          payload: { siteId: fixture.siteId },
          status: CommandStatus.PENDING,
        },
      });

      const result = await issueInverterCommand({
        userId: fixture.userId,
        siteId: fixture.siteId,
        type: "turnon",
        idempotencyKey,
      });

      expect(result).toMatchObject({ id: pending.id, status: CommandStatus.CANCELED, repeated: true });
      await expect(
        prisma.energySite.findUniqueOrThrow({ where: { id: fixture.siteId } }),
      ).resolves.toMatchObject({ optimizationOn: false });
      await expect(
        prisma.inverterCommand.count({
          where: {
            inverterId: fixture.inverterId,
            type: "turnoff",
            status: CommandStatus.ACKNOWLEDGED,
          },
        }),
      ).resolves.toBe(1);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("does not let a user-style predictable idempotency key suppress safety turnoff", async () => {
    let fixture: Fixture | null = null;
    try {
      fixture = await createFixture(false);
      await prisma.energySite.update({
        where: { id: fixture.siteId },
        data: { optimizationOn: true },
      });
      await prisma.inverterCommand.create({
        data: {
          inverterId: fixture.inverterId,
          requestedById: fixture.userId,
          idempotencyKey: `safety-disable:predictable:${fixture.siteId}:${Math.floor(Date.now() / 300_000)}`,
          type: "turnoff",
          payload: { siteId: fixture.siteId },
          status: CommandStatus.ACKNOWLEDGED,
          response: { accepted: true },
          completedAt: new Date(),
        },
      });

      const deactivation = await deactivateInverterControl(
        fixture.userId,
        "predictable-key-regression",
      );

      expect(deactivation).toMatchObject({ attempted: 1, failed: 0 });
      await expect(
        prisma.inverterCommand.count({
          where: {
            inverterId: fixture.inverterId,
            type: "turnoff",
            status: CommandStatus.ACKNOWLEDGED,
          },
        }),
      ).resolves.toBe(2);
      await expect(
        prisma.energySite.findUniqueOrThrow({ where: { id: fixture.siteId } }),
      ).resolves.toMatchObject({ optimizationOn: false });
      await expect(prisma.auditLog.findFirstOrThrow({
        where: {
          actorUserId: fixture.userId,
          action: "INVERTER_SAFETY_DEACTIVATION_COMPLETED",
          metadata: { path: ["reason"], equals: "predictable-key-regression" },
        },
      })).resolves.toMatchObject({
        entityType: "User",
        entityId: String(fixture.userId),
        metadata: { reason: "predictable-key-regression", attempted: 1, failed: 0 },
      });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("reconciles PENDING and SENT turnoff intents even when the local state is already off", async () => {
    let fixture: Fixture | null = null;
    try {
      fixture = await createFixture(false);
      const requestedAt = new Date(Date.now() - 60_000);
      const unresolved = await prisma.inverterCommand.createManyAndReturn({
        data: [
          {
            inverterId: fixture.inverterId,
            requestedById: fixture.userId,
            idempotencyKey: `energy-pending-off-${randomUUID()}`,
            type: "turnoff",
            payload: { siteId: fixture.siteId },
            status: CommandStatus.PENDING,
            requestedAt,
          },
          {
            inverterId: fixture.inverterId,
            requestedById: fixture.userId,
            idempotencyKey: `energy-sent-off-${randomUUID()}`,
            type: "turnoff",
            payload: { siteId: fixture.siteId },
            status: CommandStatus.SENT,
            requestedAt: new Date(requestedAt.getTime() + 1),
          },
        ],
      });

      const deactivation = await deactivateInverterControl(
        fixture.userId,
        `unresolved-off-${randomUUID()}`,
      );

      expect(deactivation).toMatchObject({ attempted: 1, failed: 0 });
      const reconciled = await prisma.inverterCommand.findMany({
        where: { id: { in: unresolved.map((command) => command.id) } },
        orderBy: { requestedAt: "asc" },
      });
      expect(reconciled.map((command) => command.status)).toEqual([
        CommandStatus.CANCELED,
        CommandStatus.CANCELED,
      ]);
      expect(
        reconciled.every(
          (command) =>
            command.completedAt !== null &&
            typeof command.response === "object" &&
            command.response !== null,
        ),
      ).toBe(true);
      await expect(
        prisma.auditLog.count({
          where: {
            actorUserId: fixture.userId,
            action: "INVERTER_TURNOFF_INTENTS_COMPENSATED",
          },
        }),
      ).resolves.toBe(1);
      await expect(
        prisma.energySite.findUniqueOrThrow({ where: { id: fixture.siteId } }),
      ).resolves.toMatchObject({ optimizationOn: false });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("holds the distributed lock through vendor dispatch and converges a concurrent expiry to off", async () => {
    let fixture: Fixture | null = null;
    try {
      fixture = await createFixture(true);
      const idempotencyKey = `energy-race-${randomUUID()}`;
      const turnon = issueInverterCommand({
        userId: fixture.userId,
        siteId: fixture.siteId,
        type: "turnon",
        idempotencyKey,
      });

      await waitForHeldInverterLock(fixture.inverterId, idempotencyKey);
      await prisma.subscription.updateMany({
        where: { id: fixture.subscriptionId ?? "missing" },
        data: { status: SubscriptionStatus.CANCELED, canceledAt: new Date() },
      });
      const deactivation = deactivateInverterControl(fixture.userId, `race-${randomUUID()}`);
      const [turnonResult, deactivationResult] = await Promise.all([turnon, deactivation]);

      expect([
        CommandStatus.ACKNOWLEDGED,
        CommandStatus.FAILED,
        CommandStatus.CANCELED,
      ]).toContain(turnonResult.status);
      expect(deactivationResult.failed).toBe(0);
      if (turnonResult.status === CommandStatus.ACKNOWLEDGED) {
        expect(deactivationResult.attempted).toBe(1);
      }
      await expect(
        prisma.energySite.findUniqueOrThrow({ where: { id: fixture.siteId } }),
      ).resolves.toMatchObject({ optimizationOn: false });
      await expect(
        prisma.inverterCommand.count({
          where: {
            inverterId: fixture.inverterId,
            type: "turnon",
            status: { in: [CommandStatus.PENDING, CommandStatus.SENT] },
          },
        }),
      ).resolves.toBe(0);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("does not persist a newer TURNON when revocation and OFF finish after the public precheck", async () => {
    let fixture: Fixture | null = null;
    try {
      fixture = await createFixture(true);
      const idempotencyKey = `energy-revoked-before-intent-${randomUUID()}`;
      const subscription = await prisma.subscription.findUniqueOrThrow({
        where: { id: fixture.subscriptionId ?? "missing" },
        select: { productId: true },
      });

      await expect(issueInverterCommand({
        userId: fixture.userId,
        siteId: fixture.siteId,
        type: "turnon",
        idempotencyKey,
      }, {
        beforeIntentLock: async () => {
          await prisma.subscription.update({
            where: { id: fixture?.subscriptionId ?? "missing" },
            data: { status: SubscriptionStatus.CANCELED, canceledAt: new Date(), endsAt: new Date() },
          });
          await expect(deactivateInverterControl(
            fixture!.userId,
            `revoked-before-intent-${randomUUID()}`,
          )).resolves.toMatchObject({ attempted: 1, failed: 0 });
        },
      })).rejects.toMatchObject({ code: "SUBSCRIPTION_REQUIRED" });

      await expect(prisma.inverterCommand.findUnique({ where: { idempotencyKey } }))
        .resolves.toBeNull();

      // A later purchase must not resurrect a command that was never allowed
      // to become a durable intent after the prior OFF completed.
      await prisma.subscription.create({
        data: {
          userId: fixture.userId,
          productId: subscription.productId,
          status: SubscriptionStatus.ACTIVE,
          source: SubscriptionSource.PROMO,
          startsAt: new Date(Date.now() - 1_000),
          endsAt: new Date(Date.now() + 24 * 60 * 60_000),
        },
      });
      await reconcileEntitledInverterCommands({ olderThanMs: 10_000, limit: 200 });
      await expect(prisma.inverterCommand.count({
        where: {
          inverterId: fixture.inverterId,
          type: "turnon",
          status: { in: [CommandStatus.PENDING, CommandStatus.SENT, CommandStatus.ACKNOWLEDGED] },
        },
      })).resolves.toBe(0);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("turns every inverter at a ready site on and off as one user intent", async () => {
    let fixture: Fixture | null = null;
    try {
      fixture = await createFixture(true);
      await prisma.inverter.create({
        data: {
          energySiteId: fixture.siteId,
          provider: EnergyProvider.DEMO,
          externalDeviceId: `second-${randomUUID()}`,
          name: "Second inverter",
          status: InverterStatus.ONLINE,
        },
      });
      await prisma.energySite.update({
        where: { id: fixture.siteId },
        data: { ean: "859182400000000000" },
      });
      await prisma.energySiteTechnicalProfile.create({
        data: {
          energySiteId: fixture.siteId,
          distributionTariffCode: "D25D",
          phases: 3,
          mainFuseA: 25,
          maxGridInputKw: 17.25,
          maxGridOutputKw: 10,
          exportAllowed: true,
          batteryCapacityKwh: 12,
          batteryMaxChargeKw: 6,
          batteryMaxDischargeKw: 6,
          batteryMinSocPct: 10,
          batteryMaxSocPct: 100,
          buyPricingMode: "FIX",
          sellPricingMode: "SPOT",
          fixedBuyPriceCzkKwh: 3.1,
          spotSellFeeCzkKwh: 0.2,
          fixedPriceValidUntil: new Date(Date.now() + 365 * 24 * 60 * 60_000),
        },
      });

      const enabled = await issueSiteControlCommand({
        userId: fixture.userId,
        siteId: fixture.siteId,
        type: "turnon",
        idempotencyKey: `site-on-${randomUUID()}`,
      });
      expect(enabled.commands).toHaveLength(2);
      expect(enabled.commands.every((command) => command.status === CommandStatus.ACKNOWLEDGED)).toBe(true);
      await expect(prisma.energySite.findUniqueOrThrow({ where: { id: fixture.siteId } }))
        .resolves.toMatchObject({ optimizationOn: true, requiredInfo: false });

      const disabled = await issueSiteControlCommand({
        userId: fixture.userId,
        siteId: fixture.siteId,
        type: "turnoff",
        idempotencyKey: `site-off-${randomUUID()}`,
      });
      expect(disabled.commands).toHaveLength(2);
      await expect(prisma.energySite.findUniqueOrThrow({ where: { id: fixture.siteId } }))
        .resolves.toMatchObject({ optimizationOn: false });
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
