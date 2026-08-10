import type { Metadata } from "next";

import { PageHeader } from "@/components/app-shell/PagePrimitives";
import { CartClient } from "@/components/cart/CartClient";
import { requireUser } from "@/lib/auth/guards";
import { getOrCreateCart, productFreeTrialDays } from "@/lib/commerce/cart";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Objednávka služby" };

export default async function ServiceOrderPage() {
  const session = await requireUser("/app/sluzba/objednavka");
  const userId = Number(session.user.id);
  const [cart, product, profile] = await Promise.all([
    getOrCreateCart(userId),
    prisma.product.findFirst({ where: { code: "INVERTER_CONTROL", active: true }, select: { id: true, code: true, name: true, description: true, priceMinor: true, currency: true, type: true, metadata: true } }),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, name: true, phone: true, street: true, city: true, postalCode: true, country: true, companyName: true, companyIdNumber: true, vatId: true } }),
  ]);
  const previousSubscription = product?.type === "SUBSCRIPTION" && productFreeTrialDays(product.metadata) > 0
    ? await prisma.subscription.findFirst({ where: { userId, productId: product.id }, select: { id: true } })
    : null;
  const productOffer = product && !previousSubscription
    ? {
        code: product.code,
        name: product.name,
        description: product.description,
        priceMinor: product.type === "SUBSCRIPTION" && productFreeTrialDays(product.metadata) > 0 ? 0 : product.priceMinor,
        currency: product.currency,
      }
    : null;
  return (
    <div className="space-y-6">
      <PageHeader title="Objednávka služby" description="Zkontrolujte cenu, doplňte fakturační údaje a sami zvolte, zda chcete roční automatické obnovení přes GoPay." />
      <CartClient initialCart={{ id: cart.id, totalMinor: cart.totalMinor, currency: cart.currency, items: cart.items.map((item) => ({ id: item.id, quantity: item.quantity, unitPriceMinor: item.unitPriceMinor, productName: item.productName, product: { code: item.product.code, description: item.product.description } })) }} product={productOffer} initialProfile={profile} />
    </div>
  );
}
