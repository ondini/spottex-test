import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export function productFreeTrialDays(metadata: Prisma.JsonValue | null | undefined) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return 0;
  const days = Number((metadata as Prisma.JsonObject).freeTrialDays);
  return Number.isSafeInteger(days) && days > 0 && days <= 3650 ? days : 0;
}

export async function getOrCreateCart(userId: number) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(56321::int, ${userId}::int)`;
    const existing = await tx.cart.findFirst({
      where: { userId, status: "OPEN" },
      include: { items: { include: { product: true }, orderBy: { id: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return existing;
    return tx.cart.create({
      data: { userId },
      include: { items: { include: { product: true } } },
    });
  });
}

export async function recalculateCart(cartId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${cartId}))`;
    const cart = await tx.cart.findUnique({ where: { id: cartId }, select: { status: true } });
    if (!cart || cart.status !== "OPEN") throw new Error("CART_NOT_OPEN");
    const items = await tx.cartItem.findMany({ where: { cartId } });
    const totalMinor = items.reduce((sum, item) => sum + item.unitPriceMinor * item.quantity, 0);
    return tx.cart.update({
      where: { id: cartId },
      data: { totalMinor },
      include: { items: { include: { product: true }, orderBy: { id: "asc" } } },
    });
  });
}

export function formatMoney(amountMinor: number, currency = "CZK") {
  return new Intl.NumberFormat("cs-CZ", { style: "currency", currency, maximumFractionDigits: 2 }).format(amountMinor / 100);
}
