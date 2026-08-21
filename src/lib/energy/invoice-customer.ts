import "server-only";

import { z } from "zod";

import { prisma } from "@/lib/prisma";

import { INVOICE_AI_SCHEMA_VERSION, invoiceAiDraftSchema } from "./invoice-ai";
import {
  invoiceExtractedValuesSchema,
  reviewEnergyInvoice,
} from "./invoice-review";
import { EnergyError } from "./types";
import { serializeCustomerInvoiceRequest } from "./invoice-view";

export const customerInvoiceConfirmationSchema = z
  .object({
    extracted: invoiceExtractedValuesSchema.refine(
      (values) => Object.values(values).some((value) => value != null && value !== ""),
      "Vyberte alespoň jeden vytěžený údaj.",
    ),
    sourceDocumentIds: z.array(z.string().min(1).max(100)).min(1).max(3),
  })
  .strict();

export async function getCustomerInvoiceRequest(userId: number, siteId: number) {
  const site = await prisma.energySite.findFirst({
    where: { id: siteId, userId },
    select: {
      invoiceRequests: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          documents: {
            where: { deletedAt: null },
            orderBy: { createdAt: "desc" },
          },
        },
      },
    },
  });
  if (!site) throw new EnergyError("SITE_NOT_FOUND", "Elektrárna nebyla nalezena.", 404);
  return serializeCustomerInvoiceRequest(site.invoiceRequests[0] ?? null);
}

export async function confirmCustomerInvoice(
  userId: number,
  siteId: number,
  raw: unknown,
) {
  const input = customerInvoiceConfirmationSchema.parse(raw);
  const request = await prisma.energyInvoiceRequest.findFirst({
    where: {
      energySite: { id: siteId, userId },
      status: { in: ["NEEDS_INPUT", "PROCESSING", "RECEIVED"] },
    },
    orderBy: { createdAt: "desc" },
    include: { documents: { where: { deletedAt: null } } },
  });
  if (!request) throw new Error("INVOICE_REQUEST_NOT_FOUND");
  const readyDocumentIds = new Set(
    request.documents
      .filter((document) => {
        const parsed = invoiceAiDraftSchema.safeParse(document.extractedData);
        return parsed.success && parsed.data.schemaVersion === INVOICE_AI_SCHEMA_VERSION;
      })
      .map((document) => document.id),
  );
  if (input.sourceDocumentIds.some((id) => !readyDocumentIds.has(id))) {
    throw new Error("INVOICE_DOCUMENT_MISMATCH");
  }
  await reviewEnergyInvoice(userId, request.id, {
    status: "CONFIRMED",
    documentId: null,
    billingPeriodFrom: null,
    billingPeriodTo: null,
    extracted: input.extracted,
  }, {
    ownerUserId: userId,
    confirmEvidence: true,
    notifyCustomer: false,
  });
  return getCustomerInvoiceRequest(userId, siteId);
}
