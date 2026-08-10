import "server-only";

import { Prisma } from "@prisma/client";

import { createCheckout } from "@/lib/commerce/payment";
import { prisma } from "@/lib/prisma";

import {
  calculateProAnalysisPriceMinor,
  PRO_ALL_TARIFFS_PRICE_MINOR,
} from "./pro-pricing";

function compareAllTariffs(value: Prisma.JsonValue) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.compareAllTariffs === true,
  );
}

export async function createProAnalysisCheckout(
  userId: number,
  analysisRunId: string,
) {
  const prepared = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${analysisRunId}))`;
    const run = await tx.energyAnalysisRun.findFirst({
      where: { id: analysisRunId, userId, kind: "PRO" },
    });
    if (!run) throw new Error("PRO_ANALYSIS_NOT_FOUND");
    const includesAllTariffs = compareAllTariffs(run.inputs);
    const expectedPriceMinor = calculateProAnalysisPriceMinor({
      billablePointCount: run.billablePointCount,
      compareAllTariffs: includesAllTariffs,
      pricePerExtraPointMinor: run.pricePerExtraPointMinor,
    });
    if (
      run.status !== "DRAFT" ||
      expectedPriceMinor <= 0 ||
      run.catalogComparisonPriceMinor !==
        (includesAllTariffs ? PRO_ALL_TARIFFS_PRICE_MINOR : 0) ||
      run.proPriceMinor !== expectedPriceMinor
    )
      throw new Error("PRO_ANALYSIS_NOT_CHECKOUTABLE");
    const existing = await tx.payment.findFirst({
      where: { analysisRunId: run.id, status: { in: ["PENDING", "PAID"] } },
      orderBy: { createdAt: "desc" },
    });
    if (existing?.cartId) return { cartId: existing.cartId };
    const product = await tx.product.upsert({
      where: { code: "PRO_ANALYSIS_POINT" },
      create: {
        code: "PRO_ANALYSIS_POINT",
        name: "Rozšířená analýza FVE",
        description: "Výpočet dodatečných hardwarových variant",
        type: "ONE_TIME",
        priceMinor: run.pricePerExtraPointMinor,
        currency: "CZK",
        active: true,
        metadata: { unit: "simulation-point" },
      },
      update: {
        name: "Rozšířená analýza FVE",
        priceMinor: run.pricePerExtraPointMinor,
        active: true,
      },
    });
    const cart = await tx.cart.create({
      data: {
        userId,
        status: "OPEN",
        currency: "CZK",
        totalMinor: run.proPriceMinor,
        items: {
          create: {
            productId: product.id,
            quantity: 1,
            unitPriceMinor: run.proPriceMinor,
            productName: `Rozšířená analýza${run.billablePointCount ? ` · ${run.billablePointCount} ${run.billablePointCount === 1 ? "dodatečný bod" : run.billablePointCount <= 4 ? "dodatečné body" : "dodatečných bodů"}` : ""}${includesAllTariffs ? " · všechny ceníky" : ""}`,
            metadata: {
              analysisRunId: run.id,
              billablePointCount: run.billablePointCount,
              pricePerPointMinor: run.pricePerExtraPointMinor,
              compareAllTariffs: includesAllTariffs,
            } as Prisma.InputJsonValue,
          },
        },
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "PRO_ANALYSIS_CHECKOUT_CREATED",
        entityType: "EnergyAnalysisRun",
        entityId: run.id,
        metadata: {
          cartId: cart.id,
          amountMinor: run.proPriceMinor,
          billablePointCount: run.billablePointCount,
          compareAllTariffs: includesAllTariffs,
        },
      },
    });
    return { cartId: cart.id };
  });
  return createCheckout(userId, prepared.cartId);
}
