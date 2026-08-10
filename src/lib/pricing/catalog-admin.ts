import "server-only";

import { CatalogPublicationStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import {
  validateDistributionVersion,
  validateFundingVersion,
  validateProductVersion,
  validateSourceDocument,
  type CatalogValidationReport,
  type DistributionVersionForValidation,
  type FundingVersionForValidation,
  type ProductVersionForValidation,
} from "./catalog-validation";

export type CatalogEntity =
  "source" | "product-version" | "distribution-version" | "funding-version";
export type CatalogReviewAction = "VALIDATE" | "PUBLISH" | "REJECT";

function number(value: Prisma.Decimal | number | null) {
  return value == null ? null : Number(value);
}

function sourceInput(source: {
  sourceUrl: string;
  contentSha256: string;
  rawText: string | null;
  metadata: Prisma.JsonValue;
  status: CatalogPublicationStatus;
}) {
  return { ...source, status: source.status };
}

function productInput(version: {
  validFrom: Date;
  validTo: Date | null;
  currency: string;
  vatIncluded: boolean;
  buyMode: "FIX" | "SPOT" | "TIME_CURVE";
  sellMode: "FIX" | "SPOT" | "TIME_CURVE";
  monthlyFeeCzk: Prisma.Decimal;
  fixedBuyVtCzkKwh: Prisma.Decimal | null;
  fixedBuyNtCzkKwh: Prisma.Decimal | null;
  fixedSellVtCzkKwh: Prisma.Decimal | null;
  fixedSellNtCzkKwh: Prisma.Decimal | null;
  spotBuyFeeCzkKwh: Prisma.Decimal | null;
  spotSellFeeCzkKwh: Prisma.Decimal | null;
  formula: Prisma.JsonValue;
  sourceDocument: Parameters<typeof sourceInput>[0] | null;
}): ProductVersionForValidation {
  return {
    ...version,
    monthlyFeeCzk: Number(version.monthlyFeeCzk),
    fixedBuyVtCzkKwh: number(version.fixedBuyVtCzkKwh),
    fixedBuyNtCzkKwh: number(version.fixedBuyNtCzkKwh),
    fixedSellVtCzkKwh: number(version.fixedSellVtCzkKwh),
    fixedSellNtCzkKwh: number(version.fixedSellNtCzkKwh),
    spotBuyFeeCzkKwh: number(version.spotBuyFeeCzkKwh),
    spotSellFeeCzkKwh: number(version.spotSellFeeCzkKwh),
    sourceDocument: version.sourceDocument
      ? sourceInput(version.sourceDocument)
      : null,
  };
}

function distributionInput(version: {
  validFrom: Date;
  validTo: Date | null;
  currency: string;
  vatIncluded: boolean;
  distributionVtCzkKwh: Prisma.Decimal;
  distributionNtCzkKwh: Prisma.Decimal;
  systemServicesCzkKwh: Prisma.Decimal;
  electricityTaxCzkKwh: Prisma.Decimal;
  pozeCzkKwh: Prisma.Decimal;
  monthlyMeterFeeCzk: Prisma.Decimal;
  breakerFees: Prisma.JsonValue;
  sourceDocument: Parameters<typeof sourceInput>[0] | null;
}): DistributionVersionForValidation {
  return {
    ...version,
    distributionVtCzkKwh: Number(version.distributionVtCzkKwh),
    distributionNtCzkKwh: Number(version.distributionNtCzkKwh),
    systemServicesCzkKwh: Number(version.systemServicesCzkKwh),
    electricityTaxCzkKwh: Number(version.electricityTaxCzkKwh),
    pozeCzkKwh: Number(version.pozeCzkKwh),
    monthlyMeterFeeCzk: Number(version.monthlyMeterFeeCzk),
    sourceDocument: version.sourceDocument
      ? sourceInput(version.sourceDocument)
      : null,
  };
}

async function productReport(id: number) {
  const version = await prisma.energyProductVersion.findUnique({
    where: { id },
    include: { sourceDocument: true, product: { include: { supplier: true } } },
  });
  if (!version) throw new Error("CATALOG_VERSION_NOT_FOUND");
  const previous = await prisma.energyProductVersion.findFirst({
    where: {
      productId: version.productId,
      id: { not: id },
      validFrom: { lt: version.validFrom },
      status: { in: ["VALIDATED", "PUBLISHED", "ARCHIVED"] },
    },
    orderBy: { validFrom: "desc" },
    include: { sourceDocument: true },
  });
  return {
    version,
    report: validateProductVersion(
      productInput(version),
      previous ? productInput(previous) : null,
    ),
  };
}

async function distributionReport(id: number) {
  const version = await prisma.distributionTariffVersion.findUnique({
    where: { id },
    include: {
      sourceDocument: true,
      distributionTariff: { include: { distributor: true } },
    },
  });
  if (!version) throw new Error("CATALOG_VERSION_NOT_FOUND");
  const previous = await prisma.distributionTariffVersion.findFirst({
    where: {
      distributionTariffId: version.distributionTariffId,
      id: { not: id },
      validFrom: { lt: version.validFrom },
      status: { in: ["VALIDATED", "PUBLISHED", "ARCHIVED"] },
    },
    orderBy: { validFrom: "desc" },
    include: { sourceDocument: true },
  });
  return {
    version,
    report: validateDistributionVersion(
      distributionInput(version),
      previous ? distributionInput(previous) : null,
    ),
  };
}

function fundingInput(version: {
  validFrom: Date;
  validTo: Date | null;
  territoryCodes: string[];
  customerSegments: string[];
  supportedTechnologies: string[];
  minimumAmountCzk: Prisma.Decimal | null;
  maximumAmountCzk: Prisma.Decimal | null;
  subsidyRatePct: Prisma.Decimal | null;
  interestRatePct: Prisma.Decimal | null;
  aprPct: Prisma.Decimal | null;
  feesCzk: Prisma.Decimal | null;
  conditions: Prisma.JsonValue;
  calculationFormula: Prisma.JsonValue;
  fundingProgram: { kind: "GRANT" | "LOAN" };
  sourceDocument: Parameters<typeof sourceInput>[0] | null;
}): FundingVersionForValidation {
  return {
    ...version,
    kind: version.fundingProgram.kind,
    minimumAmountCzk: number(version.minimumAmountCzk),
    maximumAmountCzk: number(version.maximumAmountCzk),
    subsidyRatePct: number(version.subsidyRatePct),
    interestRatePct: number(version.interestRatePct),
    aprPct: number(version.aprPct),
    feesCzk: number(version.feesCzk),
    sourceDocument: version.sourceDocument
      ? sourceInput(version.sourceDocument)
      : null,
  };
}

async function fundingReport(id: number) {
  const version = await prisma.fundingProgramVersion.findUnique({
    where: { id },
    include: { sourceDocument: true, fundingProgram: true },
  });
  if (!version) throw new Error("CATALOG_VERSION_NOT_FOUND");
  return { version, report: validateFundingVersion(fundingInput(version)) };
}

async function reviewFundingVersion(input: {
  actorUserId: number;
  id: number;
  action: CatalogReviewAction;
  acceptWarnings?: boolean;
  rejectionReason?: string;
}) {
  const loaded = await fundingReport(input.id);
  if (input.action === "REJECT") {
    if (!input.rejectionReason?.trim())
      throw new Error("CATALOG_REJECTION_REASON_REQUIRED");
    const item = await prisma.fundingProgramVersion.update({
      where: { id: input.id },
      data: { status: "REJECTED" },
    });
    await prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: "CATALOG_VERSION_REJECTED",
        entityType: "funding-version",
        entityId: String(input.id),
        metadata: { reason: input.rejectionReason.trim() },
      },
    });
    return { item, report: loaded.report };
  }
  assertReviewable(loaded.report, Boolean(input.acceptWarnings));
  if (input.action === "VALIDATE") {
    const item = await prisma.fundingProgramVersion.update({
      where: { id: input.id },
      data: { status: "VALIDATED" },
    });
    await prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: "CATALOG_VERSION_VALIDATED",
        entityType: "funding-version",
        entityId: String(input.id),
        metadata: { report: loaded.report } as unknown as Prisma.InputJsonValue,
      },
    });
    return { item, report: loaded.report };
  }
  if (loaded.version.status !== "VALIDATED")
    throw new Error("CATALOG_INVALID_TRANSITION");
  const validTo =
    loaded.version.validTo ?? new Date("9999-12-31T23:59:59.999Z");
  const overlaps = await prisma.fundingProgramVersion.findMany({
    where: {
      fundingProgramId: loaded.version.fundingProgramId,
      id: { not: input.id },
      status: "PUBLISHED",
      validFrom: { lt: validTo },
      OR: [{ validTo: null }, { validTo: { gt: loaded.version.validFrom } }],
    },
  });
  if (
    !overlaps.every((version) => version.validFrom < loaded.version.validFrom)
  )
    throw new Error("CATALOG_PUBLICATION_OVERLAP");
  return prisma.$transaction(async (tx) => {
    for (const overlap of overlaps)
      await tx.fundingProgramVersion.update({
        where: { id: overlap.id },
        data: { validTo: loaded.version.validFrom },
      });
    const item = await tx.fundingProgramVersion.update({
      where: { id: input.id },
      data: { status: "PUBLISHED" },
    });
    await tx.catalogSourceDocument.update({
      where: { id: loaded.version.sourceDocumentId },
      data: { status: "PUBLISHED" },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: "CATALOG_VERSION_PUBLISHED",
        entityType: "funding-version",
        entityId: String(input.id),
        metadata: { report: loaded.report } as unknown as Prisma.InputJsonValue,
      },
    });
    return { item, report: loaded.report };
  });
}

function assertReviewable(
  report: CatalogValidationReport,
  acceptWarnings: boolean,
) {
  if (!report.valid) throw new Error("CATALOG_VALIDATION_FAILED");
  if (
    !acceptWarnings &&
    report.issues.some((issue) => issue.severity === "WARNING")
  )
    throw new Error("CATALOG_WARNINGS_NOT_ACCEPTED");
}

export async function reviewCatalogEntity(input: {
  actorUserId: number;
  entity: CatalogEntity;
  id: string;
  action: CatalogReviewAction;
  acceptWarnings?: boolean;
  rejectionReason?: string;
}) {
  if (input.entity === "source") {
    const source = await prisma.catalogSourceDocument.findUnique({
      where: { id: input.id },
    });
    if (!source) throw new Error("CATALOG_SOURCE_NOT_FOUND");
    if (input.action === "PUBLISH")
      throw new Error("CATALOG_INVALID_TRANSITION");
    if (input.action === "REJECT") {
      if (!input.rejectionReason?.trim())
        throw new Error("CATALOG_REJECTION_REASON_REQUIRED");
      const rejectionReason = input.rejectionReason.trim();
      return prisma.$transaction(async (tx) => {
        const updated = await tx.catalogSourceDocument.update({
          where: { id: source.id },
          data: {
            status: "REJECTED",
            reviewedAt: new Date(),
            reviewedBy: String(input.actorUserId),
            metadata: {
              ...(source.metadata as Prisma.JsonObject),
              rejectionReason,
            },
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: input.actorUserId,
            action: "CATALOG_SOURCE_REJECTED",
            entityType: "CatalogSourceDocument",
            entityId: source.id,
            metadata: { reason: rejectionReason },
          },
        });
        return {
          item: updated,
          report: validateSourceDocument(sourceInput(source)),
        };
      });
    }
    const report = validateSourceDocument(sourceInput(source));
    assertReviewable(report, Boolean(input.acceptWarnings));
    return prisma.$transaction(async (tx) => {
      const updated = await tx.catalogSourceDocument.update({
        where: { id: source.id },
        data: {
          status: "VALIDATED",
          reviewedAt: new Date(),
          reviewedBy: String(input.actorUserId),
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "CATALOG_SOURCE_VALIDATED",
          entityType: "CatalogSourceDocument",
          entityId: source.id,
          metadata: { report } as unknown as Prisma.InputJsonValue,
        },
      });
      return { item: updated, report };
    });
  }

  const numericId = Number(input.id);
  if (!Number.isInteger(numericId) || numericId <= 0)
    throw new Error("CATALOG_VERSION_NOT_FOUND");
  if (input.entity === "funding-version")
    return reviewFundingVersion({ ...input, id: numericId });
  const loaded =
    input.entity === "product-version"
      ? await productReport(numericId)
      : await distributionReport(numericId);
  if (input.action === "REJECT") {
    if (!input.rejectionReason?.trim())
      throw new Error("CATALOG_REJECTION_REASON_REQUIRED");
    const rejectionReason = input.rejectionReason.trim();
    await prisma.$transaction(async (tx) => {
      if (input.entity === "product-version")
        await tx.energyProductVersion.update({
          where: { id: numericId },
          data: { status: "REJECTED" },
        });
      else
        await tx.distributionTariffVersion.update({
          where: { id: numericId },
          data: { status: "REJECTED" },
        });
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "CATALOG_VERSION_REJECTED",
          entityType: input.entity,
          entityId: input.id,
          metadata: { reason: rejectionReason },
        },
      });
    });
    return {
      item: { id: numericId, status: "REJECTED" },
      report: loaded.report,
    };
  }
  assertReviewable(loaded.report, Boolean(input.acceptWarnings));
  if (input.action === "VALIDATE") {
    const item =
      input.entity === "product-version"
        ? await prisma.energyProductVersion.update({
            where: { id: numericId },
            data: { status: "VALIDATED" },
          })
        : await prisma.distributionTariffVersion.update({
            where: { id: numericId },
            data: { status: "VALIDATED" },
          });
    await prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: "CATALOG_VERSION_VALIDATED",
        entityType: input.entity,
        entityId: input.id,
        metadata: { report: loaded.report } as unknown as Prisma.InputJsonValue,
      },
    });
    return { item, report: loaded.report };
  }
  if (loaded.version.status !== "VALIDATED")
    throw new Error("CATALOG_INVALID_TRANSITION");
  const validTo =
    loaded.version.validTo ?? new Date("9999-12-31T23:59:59.999Z");
  const overlaps =
    input.entity === "product-version"
      ? await prisma.energyProductVersion.findMany({
          where: {
            productId:
              "productId" in loaded.version ? loaded.version.productId : -1,
            id: { not: numericId },
            status: "PUBLISHED",
            validFrom: { lt: validTo },
            OR: [
              { validTo: null },
              { validTo: { gt: loaded.version.validFrom } },
            ],
          },
        })
      : await prisma.distributionTariffVersion.findMany({
          where: {
            distributionTariffId:
              "distributionTariffId" in loaded.version
                ? loaded.version.distributionTariffId
                : -1,
            id: { not: numericId },
            status: "PUBLISHED",
            validFrom: { lt: validTo },
            OR: [
              { validTo: null },
              { validTo: { gt: loaded.version.validFrom } },
            ],
          },
        });
  const canClose = overlaps.every(
    (version) => version.validFrom < loaded.version.validFrom,
  );
  if (!canClose) throw new Error("CATALOG_PUBLICATION_OVERLAP");
  return prisma.$transaction(async (tx) => {
    for (const overlap of overlaps) {
      if (input.entity === "product-version")
        await tx.energyProductVersion.update({
          where: { id: overlap.id },
          data: { validTo: loaded.version.validFrom },
        });
      else
        await tx.distributionTariffVersion.update({
          where: { id: overlap.id },
          data: { validTo: loaded.version.validFrom },
        });
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: "CATALOG_PREVIOUS_VERSION_CLOSED",
          entityType: input.entity,
          entityId: String(overlap.id),
          metadata: {
            validTo: loaded.version.validFrom.toISOString(),
            supersededBy: numericId,
          },
        },
      });
    }
    const item =
      input.entity === "product-version"
        ? await tx.energyProductVersion.update({
            where: { id: numericId },
            data: { status: "PUBLISHED" },
          })
        : await tx.distributionTariffVersion.update({
            where: { id: numericId },
            data: { status: "PUBLISHED" },
          });
    if (loaded.version.sourceDocumentId)
      await tx.catalogSourceDocument.update({
        where: { id: loaded.version.sourceDocumentId },
        data: { status: "PUBLISHED" },
      });
    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: "CATALOG_VERSION_PUBLISHED",
        entityType: input.entity,
        entityId: input.id,
        metadata: {
          report: loaded.report,
          acceptedWarnings: Boolean(input.acceptWarnings),
        } as unknown as Prisma.InputJsonValue,
      },
    });
    return { item, report: loaded.report };
  });
}

export async function getCatalogReviewQueue() {
  const [sources, products, distributions, funding] = await Promise.all([
    prisma.catalogSourceDocument.findMany({
      where: { status: { in: ["DRAFT", "VALIDATED", "REJECTED"] } },
      include: { company: true },
      orderBy: { retrievedAt: "desc" },
      take: 100,
    }),
    prisma.energyProductVersion.findMany({
      where: { status: { in: ["DRAFT", "VALIDATED", "REJECTED"] } },
      include: {
        product: { include: { supplier: true } },
        sourceDocument: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.distributionTariffVersion.findMany({
      where: { status: { in: ["DRAFT", "VALIDATED", "REJECTED"] } },
      include: {
        distributionTariff: { include: { distributor: true } },
        sourceDocument: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.fundingProgramVersion.findMany({
      where: { status: { in: ["DRAFT", "VALIDATED", "REJECTED"] } },
      include: { fundingProgram: true, sourceDocument: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);
  return {
    sources: sources.map((source) => ({
      id: source.id,
      title: source.title,
      company: source.company?.name ?? "Bez společnosti",
      sourceUrl: source.sourceUrl,
      status: source.status,
      retrievedAt: source.retrievedAt.toISOString(),
      report: validateSourceDocument(sourceInput(source)),
    })),
    products: await Promise.all(
      products.map(async (version) => {
        const { report } = await productReport(version.id);
        return {
          id: version.id,
          title: `${version.product.supplier.name} · ${version.product.name}`,
          status: version.status,
          validFrom: version.validFrom.toISOString(),
          validTo: version.validTo?.toISOString() ?? null,
          report,
        };
      }),
    ),
    distributions: await Promise.all(
      distributions.map(async (version) => {
        const { report } = await distributionReport(version.id);
        return {
          id: version.id,
          title: `${version.distributionTariff.distributor.name} · ${version.distributionTariff.code}`,
          status: version.status,
          validFrom: version.validFrom.toISOString(),
          validTo: version.validTo?.toISOString() ?? null,
          report,
        };
      }),
    ),
    funding: await Promise.all(
      funding.map(async (version) => {
        const { report } = await fundingReport(version.id);
        return {
          id: version.id,
          title: `${version.fundingProgram.providerName} · ${version.fundingProgram.name}`,
          kind: version.fundingProgram.kind,
          status: version.status,
          validFrom: version.validFrom.toISOString(),
          validTo: version.validTo?.toISOString() ?? null,
          report,
        };
      }),
    ),
  };
}
