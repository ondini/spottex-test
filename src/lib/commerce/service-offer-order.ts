import "server-only";

import { Prisma } from "@prisma/client";

import { getOrCreateCart } from "./cart";
import { prisma } from "@/lib/prisma";

export async function prepareServiceOfferOrder(userId: number, offerId: string) {
  const cart = await getOrCreateCart(userId);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${cart.id}))`;
    const [openCart, offer, product] = await Promise.all([
      tx.cart.findFirst({ where: { id: cart.id, userId, status: "OPEN" } }),
      tx.serviceOffer.findFirst({ where: { id: offerId, userId, status: "OFFERED", validUntil: { gt: new Date() }, finalPriceMinor: { gt: 0 }, analysisRun: { is: { status: "COMPLETED" } } } }),
      tx.product.findFirst({ where: { code: "INVERTER_CONTROL", type: "SUBSCRIPTION", active: true } }),
    ]);
    if (!openCart) throw new Error("CART_NOT_OPEN");
    if (!offer) throw new Error("SERVICE_OFFER_NOT_AVAILABLE");
    if (!product || product.currency !== offer.currency) throw new Error("SERVICE_PRODUCT_NOT_AVAILABLE");
    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    await tx.cartItem.create({
      data: {
        cartId: cart.id,
        productId: product.id,
        quantity: 1,
        unitPriceMinor: offer.finalPriceMinor,
        productName: `Chytré řízení na rok · nabídka podle úspory`,
        metadata: { serviceOfferId: offer.id, expectedControlSavingsMinor: offer.expectedControlSavingsMinor, listPriceMinor: offer.listPriceMinor, discountMinor: offer.discountMinor } as Prisma.InputJsonValue,
      },
    });
    await tx.cart.update({ where: { id: cart.id }, data: { totalMinor: offer.finalPriceMinor, currency: offer.currency } });
    await tx.auditLog.create({ data: { actorUserId: userId, action: "SERVICE_OFFER_ORDER_PREPARED", entityType: "ServiceOffer", entityId: offer.id, metadata: { cartId: cart.id, finalPriceMinor: offer.finalPriceMinor } } });
    return { cartId: cart.id, redirectUrl: "/app/sluzba/objednavka" };
  });
}
