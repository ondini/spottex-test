import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { apiUser } from "@/lib/auth/guards";
import { getOrCreateCart, productFreeTrialDays } from "@/lib/commerce/cart";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await apiUser();
  if (!session) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  return NextResponse.json({ cart: await getOrCreateCart(Number(session.user.id)) });
}

const addSchema = z.object({ productCode: z.string().min(1).max(80), quantity: z.number().int().min(1).max(24).default(1) });

export async function POST(request: NextRequest) {
  const session = await apiUser();
  if (!session) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const parsed = addSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const cart = await getOrCreateCart(Number(session.user.id));
  try {
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${cart.id}))`;
      const openCart = await tx.cart.findFirst({ where: { id: cart.id, userId: Number(session.user.id), status: "OPEN" } });
      if (!openCart) throw new Error("CART_NOT_OPEN");
      const product = await tx.product.findFirst({ where: { code: parsed.data.productCode, active: true } });
      if (!product) throw new Error("PRODUCT_NOT_FOUND");
      if (product.currency !== openCart.currency || product.priceMinor < 0) throw new Error("PRODUCT_CURRENCY_MISMATCH");
      const quantity = product.type === "SUBSCRIPTION" ? 1 : parsed.data.quantity;
      const trialEligible = product.type === "SUBSCRIPTION" && productFreeTrialDays(product.metadata) > 0
        ? !(await tx.subscription.findFirst({
            where: { userId: Number(session.user.id), productId: product.id },
            select: { id: true },
          }))
        : false;
      if (product.type === "SUBSCRIPTION" && !trialEligible) throw new Error("SERVICE_OFFER_REQUIRED");
      const unitPriceMinor = trialEligible ? 0 : product.priceMinor;
      await tx.cartItem.upsert({
        where: { cartId_productId: { cartId: cart.id, productId: product.id } },
        update: { quantity, unitPriceMinor, productName: product.name },
        create: { cartId: cart.id, productId: product.id, quantity, unitPriceMinor, productName: product.name },
      });
      const items = await tx.cartItem.findMany({ where: { cartId: cart.id } });
      const totalMinor = items.reduce((sum, item) => sum + item.unitPriceMinor * item.quantity, 0);
      if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) throw new Error("CART_TOTAL_INVALID");
      return tx.cart.update({ where: { id: cart.id }, data: { totalMinor }, include: { items: { include: { product: true }, orderBy: { id: "asc" } } } });
    });
    return NextResponse.json({ cart: updated }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "CART_UPDATE_FAILED";
    return NextResponse.json({ error: code }, { status: code === "PRODUCT_NOT_FOUND" ? 404 : 409 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await apiUser();
  if (!session) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const cart = await getOrCreateCart(Number(session.user.id));
  const productCode = request.nextUrl.searchParams.get("productCode");
  if (!productCode) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  try {
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${cart.id}))`;
      const openCart = await tx.cart.findFirst({ where: { id: cart.id, userId: Number(session.user.id), status: "OPEN" } });
      if (!openCart) throw new Error("CART_NOT_OPEN");
      const product = await tx.product.findUnique({ where: { code: productCode }, select: { id: true } });
      if (product) await tx.cartItem.deleteMany({ where: { cartId: cart.id, productId: product.id } });
      const items = await tx.cartItem.findMany({ where: { cartId: cart.id } });
      const totalMinor = items.reduce((sum, item) => sum + item.unitPriceMinor * item.quantity, 0);
      return tx.cart.update({ where: { id: cart.id }, data: { totalMinor }, include: { items: { include: { product: true }, orderBy: { id: "asc" } } } });
    });
    return NextResponse.json({ cart: updated });
  } catch {
    return NextResponse.json({ error: "CART_NOT_OPEN" }, { status: 409 });
  }
}
