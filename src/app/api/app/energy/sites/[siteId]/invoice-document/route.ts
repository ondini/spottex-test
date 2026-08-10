import { NextRequest } from "next/server";
import { z } from "zod";

import { apiUser } from "@/lib/auth/guards";
import { noStoreJson } from "@/lib/energy/http";
import { documentUploadError, ENERGY_INVOICE_MAX_BYTES, uploadEnergyInvoiceDocument } from "@/lib/energy/invoice-document";
import { consumeRateLimit } from "@/lib/security/rate-limit";

const siteIdSchema = z.coerce.number().int().positive();

export async function POST(request: NextRequest, context: { params: Promise<{ siteId: string }> }) {
  const session = await apiUser();
  if (!session) return noStoreJson({ error: "UNAUTHORIZED" }, { status: 401 });
  const siteId = siteIdSchema.safeParse((await context.params).siteId);
  if (!siteId.success) return noStoreJson({ error: "INVALID_SITE" }, { status: 400 });
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > ENERGY_INVOICE_MAX_BYTES + 256_000) return noStoreJson({ error: "DOCUMENT_TOO_LARGE" }, { status: 413 });
  const userId = Number(session.user.id);
  const limit = await consumeRateLimit(request, {
    scope: "energy-invoice-upload",
    identity: `${userId}:${siteId.data}`,
    includeAddress: false,
    limit: 5,
    windowMs: 10 * 60_000,
  });
  if (!limit.allowed) return noStoreJson({ error: "RATE_LIMITED" }, { status: 429 });
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return noStoreJson({ error: "EMPTY_DOCUMENT" }, { status: 400 });
    if (file.size > ENERGY_INVOICE_MAX_BYTES) return noStoreJson({ error: "DOCUMENT_TOO_LARGE" }, { status: 413 });
    const document = await uploadEnergyInvoiceDocument(userId, siteId.data, {
      originalFileName: file.name,
      declaredMimeType: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    return noStoreJson({
      document: {
        id: document.id,
        originalFileName: document.originalFileName,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        retainedUntil: document.retainedUntil.toISOString(),
      },
    }, { status: 201 });
  } catch (error) {
    const mapped = documentUploadError(error);
    return noStoreJson({ error: mapped.code }, { status: mapped.status });
  }
}
