import { z } from "zod";

import { apiUser } from "@/lib/auth/guards";
import {
  confirmCustomerInvoice,
  customerInvoiceConfirmationSchema,
  getCustomerInvoiceRequest,
} from "@/lib/energy/invoice-customer";
import { energyErrorResponse, noStoreJson } from "@/lib/energy/http";
import { consumeRateLimit } from "@/lib/security/rate-limit";

const siteIdSchema = z.coerce.number().int().positive();

export async function GET(
  _request: Request,
  context: { params: Promise<{ siteId: string }> },
) {
  const session = await apiUser();
  if (!session) return noStoreJson({ error: "UNAUTHORIZED" }, { status: 401 });
  const siteId = siteIdSchema.safeParse((await context.params).siteId);
  if (!siteId.success) return noStoreJson({ error: "INVALID_SITE" }, { status: 400 });
  try {
    return noStoreJson({
      invoiceRequest: await getCustomerInvoiceRequest(Number(session.user.id), siteId.data),
    });
  } catch (error) {
    return energyErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ siteId: string }> },
) {
  const session = await apiUser();
  if (!session) return noStoreJson({ error: "UNAUTHORIZED" }, { status: 401 });
  const [params, body] = await Promise.all([context.params, request.json().catch(() => null)]);
  const siteId = siteIdSchema.safeParse(params.siteId);
  const input = customerInvoiceConfirmationSchema.safeParse(body);
  if (!siteId.success || !input.success) {
    return noStoreJson({ error: "INVALID_INPUT" }, { status: 400 });
  }
  const userId = Number(session.user.id);
  const limit = await consumeRateLimit(request, {
    scope: "energy-invoice-confirm",
    identity: `${userId}:${siteId.data}`,
    includeAddress: false,
    limit: 5,
    windowMs: 10 * 60_000,
  });
  if (!limit.allowed) return noStoreJson({ error: "RATE_LIMITED" }, { status: 429 });
  try {
    return noStoreJson({
      invoiceRequest: await confirmCustomerInvoice(userId, siteId.data, input.data),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVOICE_CONFIRM_FAILED";
    if (["INVOICE_REQUEST_NOT_FOUND", "INVOICE_DOCUMENT_MISMATCH"].includes(code)) {
      return noStoreJson({ error: code }, { status: code === "INVOICE_REQUEST_NOT_FOUND" ? 404 : 409 });
    }
    return energyErrorResponse(error);
  }
}
