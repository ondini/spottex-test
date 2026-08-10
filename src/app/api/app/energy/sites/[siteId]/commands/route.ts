import { z } from "zod";

import { apiUser } from "@/lib/auth/guards";
import { energyErrorResponse, noStoreJson } from "@/lib/energy/http";
import { issueSiteControlCommand } from "@/lib/energy/service";
import { hasInverterControlEntitlement } from "@/lib/commerce/entitlement";
import { consumeRateLimit } from "@/lib/security/rate-limit";

const commandSchema = z.object({ type: z.enum(["turnon", "turnoff", "sync"]) });
const idempotencySchema = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);

export async function POST(
  request: Request,
  context: { params: Promise<{ siteId: string }> },
) {
  const session = await apiUser();
  if (!session) return noStoreJson({ error: "Přihlaste se prosím." }, { status: 401 });

  const [{ siteId: rawSiteId }, body] = await Promise.all([
    context.params,
    request.json().catch(() => null),
  ]);
  const siteId = Number(rawSiteId);
  const parsed = commandSchema.safeParse(body);
  const idempotency = idempotencySchema.safeParse(request.headers.get("idempotency-key"));
  if (!Number.isInteger(siteId) || siteId <= 0 || !parsed.success || !idempotency.success) {
    return noStoreJson(
      { error: "Neplatný příkaz nebo chybějící idempotency klíč." },
      { status: 400 },
    );
  }
  const userId = Number(session.user.id);
  if (!(await hasInverterControlEntitlement(userId))) {
    return noStoreJson({ error: "Řízení střídače vyžaduje aktivní předplatné nebo PROMO přístup.", code: "SUBSCRIPTION_REQUIRED" }, { status: 403 });
  }
  const limit = await consumeRateLimit(request, { scope: "inverter-command", identity: `${userId}:${siteId}`, includeAddress: false, limit: 6, windowMs: 60_000 });
  if (!limit.allowed) {
    return noStoreJson({ error: "Příkazy odesíláte příliš rychle. Chvíli počkejte.", code: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }

  try {
    const result = await issueSiteControlCommand({
      userId,
      siteId,
      type: parsed.data.type,
      idempotencyKey: idempotency.data,
    });
    return noStoreJson(result, { status: 200 });
  } catch (error) {
    return energyErrorResponse(error);
  }
}
