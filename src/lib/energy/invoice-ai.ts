import { z } from "zod";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

const nullableText = z.string().trim().max(300).nullable();
const nullableNumber = z.number().finite().nullable();

export const INVOICE_AI_SCHEMA_VERSION = "energy-invoice-ai-v2" as const;
export const INVOICE_AI_FAILED_MARKER = "ai-codex-v2-failed" as const;

export const invoiceAiDraftSchema = z
  .object({
    schemaVersion: z.enum(["energy-invoice-ai-v1", INVOICE_AI_SCHEMA_VERSION]),
    billingPeriodFrom: z.string().date().nullable(),
    billingPeriodTo: z.string().date().nullable(),
    values: z
      .object({
        ean: nullableText,
        address: nullableText,
        distributorCode: nullableText,
        distributionTariffCode: nullableText,
        phases: z.number().int().min(1).max(3).nullable(),
        mainFuseA: nullableNumber,
        buyPricingMode: z.enum(["FIX", "SPOT", "OTHER"]).nullable(),
        sellPricingMode: z.enum(["FIX", "SPOT", "OTHER"]).nullable(),
        currentSupplierName: nullableText,
        currentProductName: nullableText,
        monthlySupplierFeeCzk: nullableNumber,
        fixedBuyPriceCzkKwh: nullableNumber,
        fixedSellPriceCzkKwh: nullableNumber,
        spotBuyFeeCzkKwh: nullableNumber,
        spotSellFeeCzkKwh: nullableNumber,
        fixedPriceValidUntil: z.string().date().nullable(),
        hdoStatus: z
          .enum(["EXACT", "USER_CONFIRMED", "MODELED", "MISSING"])
          .nullable(),
      })
      .strict(),
    fieldEvidence: z
      .array(
        z
          .object({
            field: z.string().min(1).max(100),
            confidence: z.enum(["HIGH", "MEDIUM", "LOW", "MISSING"]),
            evidence: z.string().max(500),
          })
          .strict(),
      )
      .max(40),
    warnings: z.array(z.string().max(1_000)).max(30),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.billingPeriodFrom &&
      value.billingPeriodTo &&
      value.billingPeriodTo <= value.billingPeriodFrom
    )
      context.addIssue({
        code: "custom",
        path: ["billingPeriodTo"],
        message: "Konec období musí být po začátku.",
      });
  });

export type InvoiceAiDraft = z.infer<typeof invoiceAiDraftSchema>;

export async function persistInvoiceAiDraft(
  documentId: string,
  requestId: string,
  raw: unknown,
) {
  const draft = invoiceAiDraftSchema.parse(raw);
  const billingPeriodFrom = draft.billingPeriodFrom
    ? new Date(`${draft.billingPeriodFrom}T00:00:00.000Z`)
    : null;
  const billingPeriodTo = draft.billingPeriodTo
    ? new Date(`${draft.billingPeriodTo}T00:00:00.000Z`)
    : null;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`energy-invoice-extraction:${requestId}`}))`;
    const document = await tx.energyInvoiceDocument.findFirst({
      where: { id: documentId, invoiceRequestId: requestId, deletedAt: null },
      select: { id: true },
    });
    if (!document) throw new Error("INVOICE_AI_DOCUMENT_NOT_FOUND");
    const existing = await tx.energyInvoiceExtraction.findFirst({
      where: { documentId, method: "AI_CODEX_DRAFT", schemaVersion: draft.schemaVersion },
      select: { id: true },
    });
    if (existing) return { id: existing.id, duplicate: true };
    const latest = await tx.energyInvoiceExtraction.aggregate({
      where: { invoiceRequestId: requestId },
      _max: { version: true },
    });
    const version = (latest._max.version ?? 0) + 1;
    const extraction = await tx.energyInvoiceExtraction.create({
      data: {
        invoiceRequestId: requestId,
        documentId,
        version,
        method: "AI_CODEX_DRAFT",
        schemaVersion: draft.schemaVersion,
        billingPeriodFrom,
        billingPeriodTo,
        extractedData: draft as unknown as Prisma.InputJsonValue,
      },
    });
    await tx.energyInvoiceDocument.update({
      where: { id: documentId },
      data: {
        billingPeriodFrom,
        billingPeriodTo,
        extractionVersion: `${draft.schemaVersion === INVOICE_AI_SCHEMA_VERSION ? "ai-codex-v2" : "ai-codex-v1"}-draft-v${version}`,
        extractedData: draft as unknown as Prisma.InputJsonValue,
      },
    });
    await tx.energyInvoiceRequest.update({
      where: { id: requestId },
      data: { status: "NEEDS_INPUT" },
    });
    await tx.auditLog.create({
      data: {
        action: "ENERGY_INVOICE_AI_DRAFT_CREATED",
        entityType: "EnergyInvoiceDocument",
        entityId: documentId,
        metadata: {
          requestId,
          extractionVersion: version,
          parser: "codex-cli",
          requiresHumanReview: true,
          warningCount: draft.warnings.length,
        },
      },
    });
    return { id: extraction.id, duplicate: false };
  });
}
