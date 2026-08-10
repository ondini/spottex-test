import { randomUUID } from "node:crypto";

import {
  ConsultationBookingStatus,
  ConsultationSlotStatus,
  ProductType,
  UserStatus,
} from "@prisma/client";
import { afterAll, describe, expect, it, vi } from "vitest";

import {
  finalizePaidPayment,
  flagUnlinkedGopayCheckoutsForReview,
  invoiceYearFor,
  recurringPaymentParameters,
  reconcilePendingGopayPayments,
  reconcileGopay,
} from "@/lib/commerce/payment";
import { getOrCreateCart } from "@/lib/commerce/cart";
import { processRecurringRenewalById } from "@/lib/commerce/recurring";
import { prisma } from "@/lib/prisma";
import { hashClientAddress } from "@/lib/crypto";
import { consumeRateLimit } from "@/lib/security/rate-limit";

vi.mock("server-only", () => ({}));

const databaseDescribe =
  process.env.RUN_DB_INTEGRATION_TESTS === "true" ? describe : describe.skip;

type ConsultationFixture = {
  hostUserId: number;
  slotId: number;
  guestEmails: string[];
};

type PaymentFixture = {
  userId: number;
  productId: number;
  cartId: string;
  paymentId: string;
};

function uniqueTestValue(label: string): string {
  return `db-it-${label}-${randomUUID()}`;
}

async function createConsultationFixture(label: string): Promise<ConsultationFixture> {
  const suffix = uniqueTestValue(label);
  return prisma.$transaction(async (tx) => {
    const host = await tx.user.create({
      data: {
        email: `${suffix}@example.test`,
        passwordHash: "not-a-login-password",
        name: `Integration host ${label}`,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    const startUtc = new Date(Date.now() + 7 * 24 * 60 * 60_000);
    const slot = await tx.consultationSlot.create({
      data: {
        hostUserId: host.id,
        startUtc,
        endUtc: new Date(startUtc.getTime() + 30 * 60_000),
        status: ConsultationSlotStatus.OPEN,
        metadata: { integrationTest: suffix },
      },
    });
    return { hostUserId: host.id, slotId: slot.id, guestEmails: [] };
  });
}

/** Mirrors the production compare-and-set claim in the booking route. */
async function claimOpenSlot(
  fixture: ConsultationFixture,
  guestLabel: string,
): Promise<boolean> {
  const now = new Date();
  const holdExpiresAt = new Date(now.getTime() + 30 * 60_000);
  const guestEmail = `${uniqueTestValue(guestLabel)}@example.test`;
  fixture.guestEmails.push(guestEmail);

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.$executeRaw`
      UPDATE consultation.consultation_slot
      SET status = 'HELD', "holdExpiresAt" = ${holdExpiresAt}, "updatedAt" = now()
      WHERE id = ${fixture.slotId} AND status = 'OPEN' AND "startUtc" > ${now}
    `;
    if (claimed !== 1) return false;

    const tokenPrefix = uniqueTestValue(guestLabel);
    await tx.consultationBooking.create({
      data: {
        slotId: fixture.slotId,
        guestName: `Integration guest ${guestLabel}`,
        guestEmail,
        status: ConsultationBookingStatus.PENDING,
        manageTokenHash: `${tokenPrefix}-manage`,
        manageTokenExpiresAt: holdExpiresAt,
        verifyTokenHash: `${tokenPrefix}-verify`,
        consentAt: now,
        metadata: { integrationTest: true, verifyExpiresAt: holdExpiresAt.toISOString() },
      },
    });
    return true;
  });
}

async function cleanupConsultationFixture(fixture: ConsultationFixture | null): Promise<void> {
  if (!fixture) return;
  await prisma.emailOutbox.deleteMany({ where: { toEmail: { in: fixture.guestEmails } } });
  await prisma.consultationBooking.deleteMany({
    where: { slot: { hostUserId: fixture.hostUserId } },
  });
  await prisma.consultationSlot.deleteMany({ where: { hostUserId: fixture.hostUserId } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: fixture.hostUserId } });
  await prisma.user.deleteMany({ where: { id: fixture.hostUserId } });
}

async function createPaymentFixture(): Promise<PaymentFixture> {
  const suffix = uniqueTestValue("payment");
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: `${suffix}@example.test`,
        passwordHash: "not-a-login-password",
        name: "Integration payment user",
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    const product = await tx.product.create({
      data: {
        code: suffix,
        name: "Integration subscription",
        type: ProductType.SUBSCRIPTION,
        priceMinor: 12_300,
        billingPeriodDays: 30,
        metadata: { integrationTest: true },
      },
    });
    const cart = await tx.cart.create({
      data: {
        userId: user.id,
        status: "CHECKOUT",
        totalMinor: product.priceMinor,
        items: {
          create: {
            productId: product.id,
            quantity: 1,
            unitPriceMinor: product.priceMinor,
            productName: product.name,
            metadata: { integrationTest: true },
          },
        },
      },
    });
    const payment = await tx.payment.create({
      data: {
        userId: user.id,
        cartId: cart.id,
        provider: "MOCK",
        status: "PENDING",
        amountMinor: product.priceMinor,
        idempotencyKey: suffix,
        providerPayload: { integrationTest: true },
      },
    });
    return { userId: user.id, productId: product.id, cartId: cart.id, paymentId: payment.id };
  });
}

async function cleanupPaymentFixture(fixture: PaymentFixture | null): Promise<void> {
  if (!fixture) return;
  const paymentIds = (await prisma.payment.findMany({ where: { userId: fixture.userId }, select: { id: true } })).map(({ id }) => id);
  await prisma.emailOutbox.deleteMany({ where: { idempotencyKey: { in: paymentIds.map((id) => `payment:${id}:confirmation`) } } });
  await prisma.scheduledJob.deleteMany({
    where: {
      type: "ENERGY_INVERTER_DEACTIVATION",
      payload: { path: ["userId"], equals: fixture.userId },
    },
  });
  await prisma.invoice.deleteMany({ where: { userId: fixture.userId } });
  await prisma.subscription.deleteMany({ where: { userId: fixture.userId } });
  await prisma.auditLog.deleteMany({
    where: { entityType: "Payment", entityId: fixture.paymentId },
  });
  await prisma.payment.deleteMany({ where: { userId: fixture.userId } });
  await prisma.cart.deleteMany({ where: { userId: fixture.userId } });
  await prisma.recurringPaymentMandate.deleteMany({ where: { userId: fixture.userId } });
  await prisma.product.deleteMany({ where: { id: fixture.productId } });
  await prisma.user.deleteMany({ where: { id: fixture.userId } });
}

databaseDescribe("PostgreSQL concurrency and historical booking integration", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("allows exactly one of two concurrent claims for one OPEN consultation slot", async () => {
    let fixture: ConsultationFixture | null = null;
    try {
      fixture = await createConsultationFixture("concurrent-claim");
      const results = await Promise.all([
        claimOpenSlot(fixture, "claim-a"),
        claimOpenSlot(fixture, "claim-b"),
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);
      expect(results.filter((result) => !result)).toHaveLength(1);
      await expect(
        prisma.consultationBooking.count({ where: { slotId: fixture.slotId } }),
      ).resolves.toBe(1);
      await expect(
        prisma.consultationSlot.findUniqueOrThrow({ where: { id: fixture.slotId } }),
      ).resolves.toMatchObject({ status: ConsultationSlotStatus.HELD });
    } finally {
      await cleanupConsultationFixture(fixture);
    }
  }, 20_000);

  it("enforces non-overlapping active consultation slots at the database boundary", async () => {
    let fixture: ConsultationFixture | null = null;
    try {
      fixture = await createConsultationFixture("concurrent-overlap");
      await prisma.consultationSlot.delete({ where: { id: fixture.slotId } });
      const base = new Date(Date.now() + 10 * 24 * 60 * 60_000);
      const attempts = await Promise.allSettled([
        prisma.consultationSlot.create({
          data: { hostUserId: fixture.hostUserId, startUtc: base, endUtc: new Date(base.getTime() + 30 * 60_000) },
        }),
        prisma.consultationSlot.create({
          data: { hostUserId: fixture.hostUserId, startUtc: new Date(base.getTime() + 15 * 60_000), endUtc: new Date(base.getTime() + 45 * 60_000) },
        }),
      ]);
      expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
      expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
      await expect(prisma.consultationSlot.count({ where: { hostUserId: fixture.hostUserId } })).resolves.toBe(1);
    } finally {
      await cleanupConsultationFixture(fixture);
    }
  }, 20_000);

  it("can reserve an OPEN slot again after CANCELED and EXPIRED booking history", async () => {
    let fixture: ConsultationFixture | null = null;
    try {
      fixture = await createConsultationFixture("booking-history");
      const historyToken = uniqueTestValue("history");
      await prisma.consultationBooking.createMany({
        data: [
          {
            slotId: fixture.slotId,
            guestEmail: `${historyToken}-canceled@example.test`,
            status: ConsultationBookingStatus.CANCELED,
            manageTokenHash: `${historyToken}-canceled-manage`,
            manageTokenExpiresAt: new Date(),
            verifyTokenHash: `${historyToken}-canceled-verify`,
          },
          {
            slotId: fixture.slotId,
            guestEmail: `${historyToken}-expired@example.test`,
            status: ConsultationBookingStatus.EXPIRED,
            manageTokenHash: `${historyToken}-expired-manage`,
            manageTokenExpiresAt: new Date(),
            verifyTokenHash: `${historyToken}-expired-verify`,
          },
        ],
      });

      await expect(claimOpenSlot(fixture, "rebooked")).resolves.toBe(true);
      const bookings = await prisma.consultationBooking.findMany({
        where: { slotId: fixture.slotId },
        orderBy: { id: "asc" },
        select: { status: true },
      });
      expect(bookings.map((booking) => booking.status)).toEqual([
        ConsultationBookingStatus.CANCELED,
        ConsultationBookingStatus.EXPIRED,
        ConsultationBookingStatus.PENDING,
      ]);
    } finally {
      await cleanupConsultationFixture(fixture);
    }
  }, 20_000);

  it("finalizes one payment concurrently into exactly one invoice and subscription", async () => {
    let fixture: PaymentFixture | null = null;
    const year = invoiceYearFor(new Date());
    const counterBefore = await prisma.invoiceCounter.findUnique({ where: { year } });
    try {
      fixture = await createPaymentFixture();
      const results = await Promise.all([
        finalizePaidPayment(fixture.paymentId, { integrationAttempt: "a" }),
        finalizePaidPayment(fixture.paymentId, { integrationAttempt: "b" }),
      ]);

      expect(results).toHaveLength(2);
      expect(results.every((payment) => payment.status === "PAID")).toBe(true);
      await expect(prisma.invoice.count({ where: { paymentId: fixture.paymentId } })).resolves.toBe(1);
      await expect(
        prisma.subscription.count({ where: { paymentId: fixture.paymentId } }),
      ).resolves.toBe(1);
      await expect(
        prisma.auditLog.count({
          where: {
            action: "PAYMENT_PAID",
            entityType: "Payment",
            entityId: fixture.paymentId,
          },
        }),
      ).resolves.toBe(1);
      await expect(prisma.emailOutbox.count({
        where: { idempotencyKey: `payment:${fixture.paymentId}:confirmation` },
      })).resolves.toBe(1);
    } finally {
      await cleanupPaymentFixture(fixture);
      if (counterBefore) {
        await prisma.invoiceCounter.update({
          where: { year },
          data: { sequence: counterBefore.sequence },
        });
      } else {
        await prisma.invoiceCounter.deleteMany({ where: { year } });
      }
    }
  }, 30_000);

  it("settles one explicitly consented annual renewal exactly once", async () => {
    let fixture: PaymentFixture | null = null;
    const year = invoiceYearFor(new Date());
    const counterBefore = await prisma.invoiceCounter.findUnique({ where: { year } });
    try {
      fixture = await createPaymentFixture();
      const now = new Date();
      const consent = recurringPaymentParameters(now).consent;
      await prisma.payment.update({
        where: { id: fixture.paymentId },
        data: { chargeKind: "MANDATE_FIRST", providerPayload: { recurringConsent: consent } },
      });
      await finalizePaidPayment(fixture.paymentId, { state: "PAID", mock: true });
      const [mandate, subscription] = await Promise.all([
        prisma.recurringPaymentMandate.findFirstOrThrow({ where: { userId: fixture.userId, status: "ACTIVE" } }),
        prisma.subscription.findFirstOrThrow({ where: { paymentId: fixture.paymentId } }),
      ]);
      const renewal = await prisma.recurringRenewal.create({
        data: {
          userId: fixture.userId,
          recurringMandateId: mandate.id,
          subscriptionId: subscription.id,
          productId: fixture.productId,
          status: "NOTICE_SENT",
          amountMinor: 12_300,
          currency: "CZK",
          noticeAt: new Date(now.getTime() - 15 * 86_400_000),
          noticeSentAt: new Date(now.getTime() - 14 * 86_400_000),
          scheduledAt: new Date(now.getTime() - 1_000),
        },
      });

      await expect(processRecurringRenewalById(renewal.id, now)).resolves.toBe("CREATED");
      await expect(processRecurringRenewalById(renewal.id, now)).resolves.toBe("SKIPPED");
      await expect(prisma.recurringRenewal.findUniqueOrThrow({ where: { id: renewal.id } })).resolves.toMatchObject({ status: "PAID", attemptCount: 1 });
      await expect(prisma.payment.count({ where: { recurringRenewalId: renewal.id } })).resolves.toBe(1);
      await expect(prisma.subscription.count({ where: { userId: fixture.userId, source: "PAID" } })).resolves.toBe(2);
    } finally {
      await cleanupPaymentFixture(fixture);
      if (counterBefore) await prisma.invoiceCounter.update({ where: { year }, data: { sequence: counterBefore.sequence } });
      else await prisma.invoiceCounter.deleteMany({ where: { year } });
    }
  }, 30_000);

  it("rejects fulfillment when cart contents no longer match the authorized amount", async () => {
    let fixture: PaymentFixture | null = null;
    try {
      fixture = await createPaymentFixture();
      await prisma.cartItem.updateMany({ where: { cartId: fixture.cartId }, data: { unitPriceMinor: 1 } });
      await expect(finalizePaidPayment(fixture.paymentId, { integrationAttempt: "tampered" })).rejects.toThrow("PAYMENT_CART_MISMATCH");
      await expect(prisma.payment.findUniqueOrThrow({ where: { id: fixture.paymentId } })).resolves.toMatchObject({ status: "PENDING" });
      await expect(prisma.invoice.count({ where: { paymentId: fixture.paymentId } })).resolves.toBe(0);
      await expect(prisma.subscription.count({ where: { paymentId: fixture.paymentId } })).resolves.toBe(0);
    } finally {
      await cleanupPaymentFixture(fixture);
    }
  });

  it("recovers and fulfills an unlinked GoPay payment from a validated notification", async () => {
    let fixture: PaymentFixture | null = null;
    const year = invoiceYearFor(new Date());
    const counterBefore = await prisma.invoiceCounter.findUnique({ where: { year } });
    try {
      fixture = await createPaymentFixture();
      await prisma.payment.update({
        where: { id: fixture.paymentId },
        data: { provider: "GOPAY", providerPaymentId: null, providerPayload: { integrationTest: true, state: "CREATE_UNCERTAIN" } },
      });
      vi.stubEnv("GOPAY_CLIENT_ID", "integration-client");
      vi.stubEnv("GOPAY_CLIENT_SECRET", "integration-secret");
      vi.stubEnv("GOPAY_GO_ID", "123456789");
      vi.stubEnv("GOPAY_API_URL", "https://gw.sandbox.gopay.com/api");
      const providerId = "987654321";
      const fetchMock = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "integration-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          id: Number(providerId),
          state: "PAID",
          amount: 12_300,
          currency: "CZK",
          order_number: fixture.paymentId,
          target: { goid: 123456789 },
          gw_url: `https://gw.sandbox.gopay.com/gw/${providerId}`,
        }), { status: 200, headers: { "content-type": "application/json" } }));

      await expect(reconcileGopay(fixture.paymentId, providerId)).resolves.toBe("PAID");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await expect(prisma.payment.findUniqueOrThrow({ where: { id: fixture.paymentId } })).resolves.toMatchObject({
        providerPaymentId: providerId,
        status: "PAID",
      });
      await expect(prisma.invoice.count({ where: { paymentId: fixture.paymentId } })).resolves.toBe(1);
      await expect(prisma.subscription.count({ where: { paymentId: fixture.paymentId } })).resolves.toBe(1);
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      await cleanupPaymentFixture(fixture);
      if (counterBefore) {
        await prisma.invoiceCounter.update({ where: { year }, data: { sequence: counterBefore.sequence } });
      } else {
        await prisma.invoiceCounter.deleteMany({ where: { year } });
      }
    }
  }, 30_000);

  it("flags an uncertain unlinked GoPay creation without reopening its immutable cart", async () => {
    let fixture: PaymentFixture | null = null;
    try {
      fixture = await createPaymentFixture();
      const now = new Date();
      await prisma.payment.update({
        where: { id: fixture.paymentId },
        data: {
          provider: "GOPAY",
          providerPaymentId: null,
          providerPayload: { integrationTest: true, state: "CREATE_UNCERTAIN" },
          updatedAt: new Date(now.getTime() - 31 * 60_000),
        },
      });

      await expect(flagUnlinkedGopayCheckoutsForReview(now)).resolves.toEqual({ scanned: 1, flagged: 1 });
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: fixture.paymentId } });
      expect(payment.status).toBe("PENDING");
      expect(payment.providerPayload).toMatchObject({ integrationTest: true, state: "CREATE_REVIEW_REQUIRED" });
      await expect(prisma.cart.findUniqueOrThrow({ where: { id: fixture.cartId } })).resolves.toMatchObject({ status: "CHECKOUT" });
      await expect(prisma.auditLog.count({
        where: { action: "GOPAY_CREATION_REVIEW_REQUIRED", entityType: "Payment", entityId: fixture.paymentId },
      })).resolves.toBe(1);
    } finally {
      await cleanupPaymentFixture(fixture);
    }
  });

  it("never downgrades a paid GoPay payment and cancels its service on a validated refund", async () => {
    let fixture: PaymentFixture | null = null;
    const year = invoiceYearFor(new Date());
    const counterBefore = await prisma.invoiceCounter.findUnique({ where: { year } });
    try {
      fixture = await createPaymentFixture();
      const providerId = "987654322";
      await prisma.payment.update({
        where: { id: fixture.paymentId },
        data: { provider: "GOPAY", providerPaymentId: providerId },
      });
      await finalizePaidPayment(fixture.paymentId, { state: "PAID" });
      vi.stubEnv("GOPAY_CLIENT_ID", "integration-client");
      vi.stubEnv("GOPAY_CLIENT_SECRET", "integration-secret");
      vi.stubEnv("GOPAY_GO_ID", "123456789");
      vi.stubEnv("GOPAY_API_URL", "https://gw.sandbox.gopay.com/api");
      const providerState = (state: string) => new Response(JSON.stringify({
        id: Number(providerId),
        state,
        amount: 12_300,
        currency: "CZK",
        order_number: fixture!.paymentId,
        target: { goid: 123456789 },
      }), { status: 200, headers: { "content-type": "application/json" } });
      const token = () => new Response(JSON.stringify({ access_token: "integration-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(token())
        .mockResolvedValueOnce(providerState("CANCELED"))
        .mockResolvedValueOnce(token())
        .mockResolvedValueOnce(providerState("REFUNDED"));

      await expect(reconcileGopay(fixture.paymentId, providerId)).resolves.toBe("CANCELED");
      await expect(prisma.payment.findUniqueOrThrow({ where: { id: fixture.paymentId } })).resolves.toMatchObject({ status: "PAID" });
      await expect(prisma.cart.findUniqueOrThrow({ where: { id: fixture.cartId } })).resolves.toMatchObject({ status: "PAID" });

      await expect(reconcileGopay(fixture.paymentId, providerId)).resolves.toBe("REFUNDED");
      await expect(prisma.payment.findUniqueOrThrow({ where: { id: fixture.paymentId } })).resolves.toMatchObject({ status: "REFUNDED" });
      await expect(prisma.subscription.findFirstOrThrow({ where: { paymentId: fixture.paymentId } })).resolves.toMatchObject({ status: "CANCELED" });
      await expect(prisma.invoice.findFirstOrThrow({ where: { paymentId: fixture.paymentId } })).resolves.toMatchObject({ status: "PAID" });
      await expect(prisma.scheduledJob.findFirstOrThrow({
        where: {
          type: "ENERGY_INVERTER_DEACTIVATION",
          payload: { path: ["userId"], equals: fixture.userId },
        },
      })).resolves.toMatchObject({ status: "SUCCEEDED" });
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      await cleanupPaymentFixture(fixture);
      if (counterBefore) {
        await prisma.invoiceCounter.update({ where: { year }, data: { sequence: counterBefore.sequence } });
      } else {
        await prisma.invoiceCounter.deleteMany({ where: { year } });
      }
    }
  }, 30_000);

  it("periodically recovers a linked pending GoPay payment that was already fully refunded", async () => {
    let fixture: PaymentFixture | null = null;
    const year = invoiceYearFor(new Date());
    const counterBefore = await prisma.invoiceCounter.findUnique({ where: { year } });
    try {
      fixture = await createPaymentFixture();
      const providerId = "987654323";
      const now = new Date();
      await prisma.payment.update({
        where: { id: fixture.paymentId },
        data: {
          provider: "GOPAY",
          providerPaymentId: providerId,
          updatedAt: new Date(now.getTime() - 10 * 60_000),
        },
      });
      vi.stubEnv("GOPAY_CLIENT_ID", "integration-client");
      vi.stubEnv("GOPAY_CLIENT_SECRET", "integration-secret");
      vi.stubEnv("GOPAY_GO_ID", "123456789");
      vi.stubEnv("GOPAY_API_URL", "https://gw.sandbox.gopay.com/api");
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "integration-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          id: Number(providerId),
          state: "REFUNDED",
          amount: 12_300,
          currency: "CZK",
          order_number: fixture.paymentId,
          target: { goid: 123456789 },
        }), { status: 200, headers: { "content-type": "application/json" } }));

      const result = await reconcilePendingGopayPayments(now, 5, 1);
      expect(result).toMatchObject({ scanned: 1, reconciled: 1, settled: 1, errors: 0 });
      await expect(prisma.payment.findUniqueOrThrow({ where: { id: fixture.paymentId } })).resolves.toMatchObject({ status: "REFUNDED" });
      await expect(prisma.subscription.findFirstOrThrow({ where: { paymentId: fixture.paymentId } })).resolves.toMatchObject({ status: "CANCELED" });
      await expect(prisma.invoice.count({ where: { paymentId: fixture.paymentId } })).resolves.toBe(1);
      await expect(prisma.scheduledJob.findFirstOrThrow({
        where: {
          type: "ENERGY_INVERTER_DEACTIVATION",
          payload: { path: ["userId"], equals: fixture.userId },
        },
      })).resolves.toMatchObject({ status: "SUCCEEDED" });
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      await cleanupPaymentFixture(fixture);
      if (counterBefore) {
        await prisma.invoiceCounter.update({ where: { year }, data: { sequence: counterBefore.sequence } });
      } else {
        await prisma.invoiceCounter.deleteMany({ where: { year } });
      }
    }
  }, 30_000);

  it("periodically recovers a missed refund after the GoPay payment was locally paid", async () => {
    let fixture: PaymentFixture | null = null;
    const year = invoiceYearFor(new Date());
    const counterBefore = await prisma.invoiceCounter.findUnique({ where: { year } });
    try {
      fixture = await createPaymentFixture();
      const providerId = "987654324";
      const now = new Date();
      await prisma.payment.update({
        where: { id: fixture.paymentId },
        data: { provider: "GOPAY", providerPaymentId: providerId },
      });
      await finalizePaidPayment(fixture.paymentId, { state: "PAID" });
      await prisma.payment.update({
        where: { id: fixture.paymentId },
        data: { updatedAt: new Date(now.getTime() - 70 * 60_000) },
      });

      vi.stubEnv("GOPAY_CLIENT_ID", "integration-client");
      vi.stubEnv("GOPAY_CLIENT_SECRET", "integration-secret");
      vi.stubEnv("GOPAY_GO_ID", "123456789");
      vi.stubEnv("GOPAY_API_URL", "https://gw.sandbox.gopay.com/api");
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "integration-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          id: Number(providerId),
          state: "REFUNDED",
          amount: 12_300,
          currency: "CZK",
          order_number: fixture.paymentId,
          target: { goid: 123456789 },
        }), { status: 200, headers: { "content-type": "application/json" } }));

      const result = await reconcilePendingGopayPayments(now, 5, 1, 5);
      expect(result).toMatchObject({ scanned: 1, pendingScanned: 0, paidScanned: 1, reconciled: 1, settled: 1, errors: 0 });
      await expect(prisma.payment.findUniqueOrThrow({ where: { id: fixture.paymentId } })).resolves.toMatchObject({ status: "REFUNDED" });
      await expect(prisma.subscription.findFirstOrThrow({ where: { paymentId: fixture.paymentId } })).resolves.toMatchObject({ status: "CANCELED" });
      await expect(prisma.invoice.findFirstOrThrow({ where: { paymentId: fixture.paymentId } })).resolves.toMatchObject({ status: "PAID" });
      await expect(prisma.scheduledJob.findFirstOrThrow({
        where: {
          type: "ENERGY_INVERTER_DEACTIVATION",
          payload: { path: ["userId"], equals: fixture.userId },
        },
      })).resolves.toMatchObject({ status: "SUCCEEDED" });
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      await cleanupPaymentFixture(fixture);
      if (counterBefore) {
        await prisma.invoiceCounter.update({ where: { year }, data: { sequence: counterBefore.sequence } });
      } else {
        await prisma.invoiceCounter.deleteMany({ where: { year } });
      }
    }
  }, 30_000);

  it("atomically enforces a concurrent database-backed rate limit", async () => {
    const scope = uniqueTestValue("rate-limit");
    const identity = uniqueTestValue("identity");
    const previousTrust = process.env.TRUST_PROXY_HEADERS;
    process.env.TRUST_PROXY_HEADERS = "false";
    try {
      const request = new Request("http://localhost/test");
      const results = await Promise.all(Array.from({ length: 10 }, () => consumeRateLimit(request, { scope, identity, limit: 3, windowMs: 60_000 })));
      expect(results.filter((result) => result.allowed)).toHaveLength(3);
      expect(results.filter((result) => !result.allowed)).toHaveLength(7);
    } finally {
      const key = hashClientAddress(`${scope}:direct-client:${identity.toLowerCase()}`);
      await prisma.rateLimitBucket.deleteMany({ where: { key } });
      process.env.TRUST_PROXY_HEADERS = previousTrust;
    }
  });

  it("enforces identity-only limits across different client addresses", async () => {
    const scope = uniqueTestValue("identity-rate-limit");
    const identity = uniqueTestValue("shared-account");
    const previousTrust = process.env.TRUST_PROXY_HEADERS;
    process.env.TRUST_PROXY_HEADERS = "true";
    try {
      const first = await consumeRateLimit(new Request("http://localhost/test", { headers: { "x-forwarded-for": "198.51.100.10" } }), {
        scope,
        identity,
        includeAddress: false,
        limit: 1,
        windowMs: 60_000,
      });
      const second = await consumeRateLimit(new Request("http://localhost/test", { headers: { "x-forwarded-for": "203.0.113.20" } }), {
        scope,
        identity,
        includeAddress: false,
        limit: 1,
        windowMs: 60_000,
      });
      expect(first.allowed).toBe(true);
      expect(second.allowed).toBe(false);
    } finally {
      const key = hashClientAddress(`${scope}:identity-only:${identity.toLowerCase()}`);
      await prisma.rateLimitBucket.deleteMany({ where: { key } });
      process.env.TRUST_PROXY_HEADERS = previousTrust;
    }
  });

  it("creates exactly one OPEN cart under concurrent first access", async () => {
    const suffix = uniqueTestValue("open-cart");
    const user = await prisma.user.create({ data: { email: `${suffix}@example.test`, passwordHash: "not-a-login-password", status: UserStatus.ACTIVE, emailVerifiedAt: new Date() } });
    try {
      const carts = await Promise.all(Array.from({ length: 10 }, () => getOrCreateCart(user.id)));
      expect(new Set(carts.map((cart) => cart.id)).size).toBe(1);
      await expect(prisma.cart.count({ where: { userId: user.id, status: "OPEN" } })).resolves.toBe(1);
    } finally {
      await prisma.cart.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
