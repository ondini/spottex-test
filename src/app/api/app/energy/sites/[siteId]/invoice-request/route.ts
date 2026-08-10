import { z } from "zod";

import { apiUser } from "@/lib/auth/guards";
import { energyErrorResponse, noStoreJson } from "@/lib/energy/http";
import { createInvoiceRequest } from "@/lib/energy/technical-profile";
import { consumeRateLimit } from "@/lib/security/rate-limit";

const siteIdSchema = z.coerce.number().int().positive();

export async function POST(
  request: Request,
  context: { params: Promise<{ siteId: string }> },
) {
  const session = await apiUser();
  if (!session) return noStoreJson({ error: "Přihlaste se prosím." }, { status: 401 });
  const parsedSiteId = siteIdSchema.safeParse((await context.params).siteId);
  if (!parsedSiteId.success) return noStoreJson({ error: "Neplatná elektrárna." }, { status: 400 });
  const userId = Number(session.user.id);
  const limit = await consumeRateLimit(request, {
    scope: "energy-invoice-request",
    identity: `${userId}:${parsedSiteId.data}`,
    includeAddress: false,
    limit: 5,
    windowMs: 60_000,
  });
  if (!limit.allowed) return noStoreJson({ error: "Požadavek už jsme přijali." }, { status: 429 });
  try {
    const invoiceRequest = await createInvoiceRequest(userId, parsedSiteId.data);
    return noStoreJson({
      invoiceRequest: {
        referenceCode: invoiceRequest.referenceCode,
        contactEmail: invoiceRequest.contactEmail,
        status: invoiceRequest.status,
        createdAt: invoiceRequest.createdAt.toISOString(),
      },
    });
  } catch (error) {
    return energyErrorResponse(error);
  }
}
