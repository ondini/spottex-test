import "server-only";

import { queueEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";

export function catalogExpirySeverity(
  validTo: Date,
  now: Date,
): "EXPIRED" | "CRITICAL" | "WARNING" | null {
  const days = (validTo.getTime() - now.getTime()) / 86_400_000;
  if (days < 0) return "EXPIRED";
  if (days <= 14) return "CRITICAL";
  if (days <= 45) return "WARNING";
  return null;
}

export async function monitorCatalogExpirations(now = new Date()) {
  const horizon = new Date(now.getTime() + 45 * 86_400_000);
  const [products, distributions, funding, admins] = await Promise.all([
    prisma.energyProductVersion.findMany({
      where: { status: "PUBLISHED", validTo: { not: null, lte: horizon } },
      include: { product: { include: { supplier: true } } },
    }),
    prisma.distributionTariffVersion.findMany({
      where: { status: "PUBLISHED", validTo: { not: null, lte: horizon } },
      include: { distributionTariff: { include: { distributor: true } } },
    }),
    prisma.fundingProgramVersion.findMany({
      where: { status: "PUBLISHED", validTo: { not: null, lte: horizon } },
      include: { fundingProgram: true },
    }),
    prisma.user.findMany({
      where: { role: "ADMIN", status: "ACTIVE" },
      select: { id: true, email: true },
    }),
  ]);
  const missing: Array<{
    type: "product" | "distribution" | "funding";
    id: number;
    label: string;
    validTo: Date;
    severity: string;
  }> = [];
  for (const version of products) {
    if (!version.validTo) continue;
    const successor = await prisma.energyProductVersion.count({
      where: {
        productId: version.productId,
        id: { not: version.id },
        status: "PUBLISHED",
        validFrom: { lte: version.validTo },
        OR: [{ validTo: null }, { validTo: { gt: version.validTo } }],
      },
    });
    const severity = catalogExpirySeverity(version.validTo, now);
    if (!successor && severity)
      missing.push({
        type: "product",
        id: version.id,
        label: `${version.product.supplier.name} · ${version.product.name}`,
        validTo: version.validTo,
        severity,
      });
  }
  for (const version of distributions) {
    if (!version.validTo) continue;
    const successor = await prisma.distributionTariffVersion.count({
      where: {
        distributionTariffId: version.distributionTariffId,
        id: { not: version.id },
        status: "PUBLISHED",
        validFrom: { lte: version.validTo },
        OR: [{ validTo: null }, { validTo: { gt: version.validTo } }],
      },
    });
    const severity = catalogExpirySeverity(version.validTo, now);
    if (!successor && severity)
      missing.push({
        type: "distribution",
        id: version.id,
        label: `${version.distributionTariff.distributor.name} · ${version.distributionTariff.code}`,
        validTo: version.validTo,
        severity,
      });
  }
  for (const version of funding) {
    if (!version.validTo) continue;
    const successor = await prisma.fundingProgramVersion.count({
      where: {
        fundingProgramId: version.fundingProgramId,
        id: { not: version.id },
        status: "PUBLISHED",
        validFrom: { lte: version.validTo },
        OR: [{ validTo: null }, { validTo: { gt: version.validTo } }],
      },
    });
    const severity = catalogExpirySeverity(version.validTo, now);
    if (!successor && severity)
      missing.push({
        type: "funding",
        id: version.id,
        label: `${version.fundingProgram.providerName} · ${version.fundingProgram.name}`,
        validTo: version.validTo,
        severity,
      });
  }
  for (const item of missing) {
    for (const admin of admins)
      await queueEmail({
        idempotencyKey: `catalog-expiry:${item.type}:${item.id}:${item.severity}:${admin.id}`,
        to: admin.email,
        subject: `Ceník SpotTEX ${item.severity === "EXPIRED" ? "expiroval" : "brzy expiruje"}`,
        text: `${item.label}\nPlatnost do: ${item.validTo.toLocaleDateString("cs-CZ")}\nNavazující publikovaná verze chybí. Zkontrolujte návrhy v administraci.\n\n${process.env.APP_URL || "http://localhost:3004"}/admin/ceniky`,
      });
  }
  return {
    checked: products.length + distributions.length + funding.length,
    missingSuccessors: missing.length,
    items: missing,
  };
}
