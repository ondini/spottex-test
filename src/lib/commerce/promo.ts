import { prisma } from "@/lib/prisma";

export async function activatePromo(input: { userId: number; adminId: number; days: number; reason: string }) {
  if (input.days < 1 || input.days > 730) throw new Error("INVALID_PROMO_DURATION");
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUniqueOrThrow({ where: { code: "INVERTER_CONTROL" } });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${input.userId}::int, ${product.id}::int)`;
    const now = new Date();
    const current = await tx.subscription.findFirst({
      where: { userId: input.userId, productId: product.id, status: { in: ["ACTIVE", "TRIAL"] }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    });
    if (current) throw new Error("ACTIVE_SUBSCRIPTION_EXISTS");
    const subscription = await tx.subscription.create({
      data: {
        userId: input.userId,
        productId: product.id,
        status: "TRIAL",
        source: "PROMO",
        startsAt: now,
        endsAt: new Date(now.getTime() + input.days * 86_400_000),
        activatedByAdminId: input.adminId,
        activationReason: input.reason,
      },
    });
    await tx.auditLog.create({
      data: { actorUserId: input.adminId, action: "PROMO_ACTIVATED", entityType: "Subscription", entityId: subscription.id, metadata: { userId: input.userId, days: input.days, reason: input.reason } },
    });
    return subscription;
  });
}
