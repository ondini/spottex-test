import "server-only";

import { EnergyValueSource, Prisma } from "@prisma/client";
import { z } from "zod";

import { supersedeSiteAnalyses } from "@/lib/analysis/invalidation";
import { queueEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";

const nullableText = z.string().trim().max(300).nullable().optional();
const nullableNumber = (min: number, max: number) =>
  z.number().finite().min(min).max(max).nullable().optional();

export const invoiceReviewSchema = z
  .object({
    status: z.enum([
      "RECEIVED",
      "PROCESSING",
      "NEEDS_INPUT",
      "CONFIRMED",
      "CANCELED",
    ]),
    notes: z.string().trim().max(5_000).nullable().optional(),
    documentId: z.string().trim().min(1).max(100).nullable().optional(),
    billingPeriodFrom: z.string().date().nullable().optional(),
    billingPeriodTo: z.string().date().nullable().optional(),
    extracted: z
      .object({
        ean: nullableText,
        address: nullableText,
        distributorCode: nullableText,
        distributionTariffCode: nullableText,
        phases: z.number().int().min(1).max(3).nullable().optional(),
        mainFuseA: nullableNumber(1, 1_000),
        buyPricingMode: z.enum(["FIX", "SPOT", "OTHER"]).nullable().optional(),
        sellPricingMode: z.enum(["FIX", "SPOT", "OTHER"]).nullable().optional(),
        currentSupplierName: nullableText,
        currentProductName: nullableText,
        monthlySupplierFeeCzk: nullableNumber(0, 100_000),
        fixedBuyPriceCzkKwh: nullableNumber(-1_000, 1_000),
        fixedSellPriceCzkKwh: nullableNumber(-1_000, 1_000),
        spotBuyFeeCzkKwh: nullableNumber(-1_000, 1_000),
        spotSellFeeCzkKwh: nullableNumber(-1_000, 1_000),
        fixedPriceValidUntil: z.string().datetime().nullable().optional(),
        hdoStatus: z
          .enum(["EXACT", "USER_CONFIRMED", "MODELED", "MISSING"])
          .nullable()
          .optional(),
      })
      .strict()
      .default({}),
  })
  .strict();

export type InvoiceReviewInput = z.infer<typeof invoiceReviewSchema>;

const SITE_FIELDS = new Set(["ean", "address"]);

function object(value: Prisma.JsonValue | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Prisma.JsonObject)
    : {};
}

export async function reviewEnergyInvoice(
  actorUserId: number,
  requestId: string,
  raw: unknown,
) {
  const input = invoiceReviewSchema.parse(raw);
  const request = await prisma.energyInvoiceRequest.findUnique({
    where: { id: requestId },
    include: {
      documents: { where: { deletedAt: null }, select: { id: true } },
      energySite: {
        include: {
          technicalProfile: true,
          user: { select: { email: true, name: true } },
        },
      },
    },
  });
  if (!request) throw new Error("INVOICE_REQUEST_NOT_FOUND");
  if (
    input.documentId &&
    !request.documents.some((document) => document.id === input.documentId)
  )
    throw new Error("INVOICE_DOCUMENT_MISMATCH");
  const billingPeriodFrom = input.billingPeriodFrom
    ? new Date(`${input.billingPeriodFrom}T00:00:00.000Z`)
    : null;
  const billingPeriodTo = input.billingPeriodTo
    ? new Date(`${input.billingPeriodTo}T00:00:00.000Z`)
    : null;
  if (
    billingPeriodFrom &&
    billingPeriodTo &&
    billingPeriodTo <= billingPeriodFrom
  )
    throw new Error("INVALID_BILLING_PERIOD");
  const now = new Date();
  const profileUpdate: Record<string, unknown> = {};
  const siteUpdate: Prisma.EnergySiteUpdateInput = {};
  const changes: Array<[string, unknown]> = [];
  for (const [field, rawValue] of Object.entries(input.extracted)) {
    if (rawValue === undefined) continue;
    const value =
      field === "fixedPriceValidUntil" && rawValue
        ? new Date(String(rawValue))
        : rawValue;
    const current = SITE_FIELDS.has(field)
      ? request.energySite[field as "ean" | "address"]
      : (request.energySite.technicalProfile?.[
          field as keyof NonNullable<typeof request.energySite.technicalProfile>
        ] ?? null);
    const comparableCurrent =
      current instanceof Date ? current.toISOString() : current;
    const comparableValue = value instanceof Date ? value.toISOString() : value;
    if (comparableCurrent === comparableValue) continue;
    if (SITE_FIELDS.has(field))
      siteUpdate[field as "ean" | "address"] = value as string | null;
    else profileUpdate[field] = value;
    changes.push([field, comparableValue]);
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`energy-invoice-extraction:${request.id}`}))`;
    if (changes.some(([field]) => !SITE_FIELDS.has(field))) {
      await tx.energySiteTechnicalProfile.upsert({
        where: { energySiteId: request.energySiteId },
        update: {
          ...profileUpdate,
          analysisConfirmedAt: null,
          controlConfirmedAt: null,
        },
        create: { energySiteId: request.energySiteId, ...profileUpdate },
      });
    }
    if (Object.keys(siteUpdate).length)
      await tx.energySite.update({
        where: { id: request.energySiteId },
        data: siteUpdate,
      });
    for (const [field, value] of changes) {
      await tx.energySiteFieldEvidence.create({
        data: {
          energySiteId: request.energySiteId,
          field,
          value:
            value == null ? Prisma.JsonNull : (value as Prisma.InputJsonValue),
          source: EnergyValueSource.INVOICE,
          sourceReference: request.referenceCode,
          observedAt: now,
        },
      });
    }
    if (changes.length) {
      await tx.energyPriceCurve.updateMany({
        where: {
          energySiteId: request.energySiteId,
          status: { in: ["DRAFT", "READY"] },
        },
        data: { status: "SUPERSEDED" },
      });
      await supersedeSiteAnalyses(tx, {
        energySiteId: request.energySiteId,
        actorUserId,
        reason:
          "Údaje z faktury změnily vstupy. Původní smart výsledek už neplatí; po potvrzení údajů spusťte nový výpočet.",
      });
    }
    const updated = await tx.energyInvoiceRequest.update({
      where: { id: request.id },
      data: {
        status: input.status,
        notes: input.notes,
        ...(["RECEIVED", "PROCESSING", "NEEDS_INPUT", "CONFIRMED"].includes(
          input.status,
        ) && !request.receivedAt
          ? { receivedAt: now }
          : {}),
        ...(input.status === "CONFIRMED" ? { processedAt: now } : {}),
      },
    });
    const latestExtraction = await tx.energyInvoiceExtraction.aggregate({
      where: { invoiceRequestId: request.id },
      _max: { version: true },
    });
    const extraction = await tx.energyInvoiceExtraction.create({
      data: {
        invoiceRequestId: request.id,
        documentId: input.documentId || null,
        version: (latestExtraction._max.version ?? 0) + 1,
        method: "MANUAL",
        schemaVersion: "energy-invoice-v1",
        billingPeriodFrom,
        billingPeriodTo,
        extractedData: input.extracted as Prisma.InputJsonValue,
        reviewedByUserId: actorUserId,
      },
    });
    if (input.documentId) {
      await tx.energyInvoiceDocument.update({
        where: { id: input.documentId },
        data: {
          billingPeriodFrom,
          billingPeriodTo,
          extractionVersion: `manual-v${extraction.version}`,
          extractedData: input.extracted as Prisma.InputJsonValue,
        },
      });
    }
    await tx.auditLog.create({
      data: {
        actorUserId,
        action: "ENERGY_INVOICE_REVIEWED",
        entityType: "EnergyInvoiceRequest",
        entityId: request.id,
        metadata: {
          status: input.status,
          changedFields: changes.map(([field]) => field),
          referenceCode: request.referenceCode,
          extractionVersion: extraction.version,
          documentId: input.documentId || null,
          billingPeriodFrom: input.billingPeriodFrom || null,
          billingPeriodTo: input.billingPeriodTo || null,
        },
      },
    });
    return updated;
  });
  if (["NEEDS_INPUT", "CONFIRMED"].includes(input.status)) {
    const confirmed = input.status === "CONFIRMED";
    await queueEmail({
      idempotencyKey: `energy-invoice:${request.id}:${input.status}:${result.updatedAt.toISOString()}`,
      to: request.energySite.user.email,
      subject: confirmed
        ? "Údaje z faktury jsou připravené ke kontrole"
        : "K faktuře potřebujeme doplnění",
      text: confirmed
        ? `Dobrý den${request.energySite.user.name ? ` ${request.energySite.user.name}` : ""},\n\núdaje z faktury ${request.referenceCode} jsme zpracovali. V části Moje elektrárna zkontrolujte jejich původ a potvrďte je pro novou analýzu.\n\n${process.env.APP_URL || "http://localhost:3004"}/app/elektrarna`
        : `Dobrý den${request.energySite.user.name ? ` ${request.energySite.user.name}` : ""},\n\nk faktuře ${request.referenceCode} potřebujeme doplnění. Poznámka: ${input.notes || "ozveme se vám s podrobnostmi"}.\n\n${process.env.APP_URL || "http://localhost:3004"}/app/elektrarna`,
    });
  }
  return result;
}

export async function getEnergyInvoiceReviewQueue() {
  const requests = await prisma.energyInvoiceRequest.findMany({
    include: {
      documents: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
      extractions: { orderBy: { version: "desc" }, take: 1 },
      energySite: {
        include: {
          user: { select: { email: true, name: true } },
          technicalProfile: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  return requests.map((request) => {
    const latestExtraction = request.extractions[0];
    const aiRoot =
      latestExtraction?.method === "AI_CODEX_DRAFT"
        ? object(latestExtraction.extractedData)
        : null;
    return {
      id: request.id,
      referenceCode: request.referenceCode,
      status: request.status,
      notes: request.notes,
      createdAt: request.createdAt.toISOString(),
      receivedAt: request.receivedAt?.toISOString() ?? null,
      documents: request.documents.map((document) => ({
        id: document.id,
        originalFileName: document.originalFileName,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        billingPeriodFrom: document.billingPeriodFrom?.toISOString() ?? null,
        billingPeriodTo: document.billingPeriodTo?.toISOString() ?? null,
        extractionVersion: document.extractionVersion,
        retainedUntil: document.retainedUntil.toISOString(),
      })),
      latestExtractionVersion: request.extractions[0]?.version ?? null,
      latestExtractionMethod: latestExtraction?.method ?? null,
      aiDraft: aiRoot
        ? {
            values: object(aiRoot.values as Prisma.JsonValue),
            fieldEvidence: Array.isArray(aiRoot.fieldEvidence)
              ? aiRoot.fieldEvidence.filter(
                  (item) =>
                    item && typeof item === "object" && !Array.isArray(item),
                )
              : [],
            warnings: Array.isArray(aiRoot.warnings)
              ? aiRoot.warnings.filter(
                  (item): item is string => typeof item === "string",
                )
              : [],
          }
        : null,
      user: request.energySite.user,
      site: {
        id: request.energySite.id,
        name: request.energySite.name,
        ean: request.energySite.ean,
        address: request.energySite.address,
      },
      profile: request.energySite.technicalProfile
        ? {
            distributorCode:
              request.energySite.technicalProfile.distributorCode,
            distributionTariffCode:
              request.energySite.technicalProfile.distributionTariffCode,
            phases: request.energySite.technicalProfile.phases,
            mainFuseA: request.energySite.technicalProfile.mainFuseA,
            buyPricingMode: request.energySite.technicalProfile.buyPricingMode,
            sellPricingMode:
              request.energySite.technicalProfile.sellPricingMode,
            currentSupplierName:
              request.energySite.technicalProfile.currentSupplierName,
            currentProductName:
              request.energySite.technicalProfile.currentProductName,
            monthlySupplierFeeCzk:
              request.energySite.technicalProfile.monthlySupplierFeeCzk,
            fixedBuyPriceCzkKwh:
              request.energySite.technicalProfile.fixedBuyPriceCzkKwh,
            fixedSellPriceCzkKwh:
              request.energySite.technicalProfile.fixedSellPriceCzkKwh,
            spotBuyFeeCzkKwh:
              request.energySite.technicalProfile.spotBuyFeeCzkKwh,
            spotSellFeeCzkKwh:
              request.energySite.technicalProfile.spotSellFeeCzkKwh,
            fixedPriceValidUntil:
              request.energySite.technicalProfile.fixedPriceValidUntil?.toISOString() ??
              null,
            hdoStatus: request.energySite.technicalProfile.hdoStatus,
          }
        : null,
    };
  });
}
