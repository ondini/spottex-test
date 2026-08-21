import "server-only";

import { Prisma } from "@prisma/client";

import {
  INVOICE_AI_FAILED_MARKER,
  INVOICE_AI_SCHEMA_VERSION,
  invoiceAiDraftSchema,
} from "./invoice-ai";

type InvoiceRequestRecord = Prisma.EnergyInvoiceRequestGetPayload<{
  include: {
    documents: {
      where: { deletedAt: null };
      orderBy: { createdAt: "desc" };
    };
  };
}>;

export function parsedInvoiceDraft(document: InvoiceRequestRecord["documents"][number]) {
  return invoiceAiDraftSchema.safeParse(document.extractedData);
}

export function serializeCustomerInvoiceRequest(request: InvoiceRequestRecord | null) {
  if (!request) return null;
  const oldestPending = [...request.documents]
    .reverse()
    .find((document) => {
      const parsed = parsedInvoiceDraft(document);
      return (
        (!parsed.success || parsed.data.schemaVersion !== INVOICE_AI_SCHEMA_VERSION) &&
        document.extractionVersion !== INVOICE_AI_FAILED_MARKER
      );
    });
  const documents = request.documents.map((document) => {
    const parsed = parsedInvoiceDraft(document);
    const currentDraft = parsed.success && parsed.data.schemaVersion === INVOICE_AI_SCHEMA_VERSION;
    const state: "QUEUED" | "PARSING" | "READY" | "FAILED" | "SAVED" = currentDraft
      ? request.status === "CONFIRMED" ? "SAVED" : "READY"
      : document.extractionVersion === INVOICE_AI_FAILED_MARKER
        ? "FAILED"
        : request.status === "PROCESSING" && oldestPending?.id === document.id
          ? "PARSING"
          : "QUEUED";
    return {
      id: document.id,
      originalFileName: document.originalFileName,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      retainedUntil: document.retainedUntil.toISOString(),
      createdAt: document.createdAt.toISOString(),
      state,
      draft: parsed.success
        ? {
            schemaVersion: parsed.data.schemaVersion,
            billingPeriodFrom: parsed.data.billingPeriodFrom,
            billingPeriodTo: parsed.data.billingPeriodTo,
            values: parsed.data.values,
            fieldEvidence: parsed.data.fieldEvidence,
            warnings: parsed.data.warnings,
          }
        : null,
    };
  });

  const values: Record<string, string | number | null> = {};
  const seen = new Map<string, Set<string>>();
  const fieldEvidence: Array<{
    field: string;
    confidence: string;
    evidence: string;
    documentId: string;
    documentName: string;
  }> = [];
  const warnings: string[] = [];
  for (const document of [...documents].reverse()) {
    if (!document.draft || !["READY", "SAVED"].includes(document.state)) continue;
    for (const [field, value] of Object.entries(document.draft.values)) {
      if (value == null || value === "") continue;
      values[field] = value;
      const variants = seen.get(field) ?? new Set<string>();
      variants.add(JSON.stringify(value));
      seen.set(field, variants);
    }
    for (const evidence of document.draft.fieldEvidence) {
      fieldEvidence.push({
        ...evidence,
        documentId: document.id,
        documentName: document.originalFileName,
      });
    }
    warnings.push(...document.draft.warnings.map((warning) => `${document.originalFileName}: ${warning}`));
  }
  const conflicts = [...seen.entries()]
    .filter(([, variants]) => variants.size > 1)
    .map(([field]) => field);

  return {
    referenceCode: request.referenceCode,
    contactEmail: request.contactEmail,
    status: request.status,
    createdAt: request.createdAt.toISOString(),
    maxDocuments: 3,
    documents,
    combined: {
      values,
      fieldEvidence,
      warnings,
      conflicts,
      sourceDocumentIds: documents
        .filter((document) => document.draft && ["READY", "SAVED"].includes(document.state))
        .map((document) => document.id),
    },
  };
}
