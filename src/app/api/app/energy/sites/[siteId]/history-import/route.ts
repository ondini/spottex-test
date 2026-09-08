import { z } from "zod";

import { apiUser } from "@/lib/auth/guards";
import { latestHistoryImport, refreshSiteHistoryIfSparse, requestHistoryImport } from "@/lib/energy/history-import";
import { energyErrorResponse, noStoreJson } from "@/lib/energy/http";
import { consumeRateLimit } from "@/lib/security/rate-limit";

const siteIdSchema = z.coerce.number().int().positive();
const requestSchema = z.object({ days: z.number().int().min(7).max(366).default(365) }).strict();

export async function GET(_request: Request, context: { params: Promise<{ siteId: string }> }) {
  const session = await apiUser();
  if (!session) return noStoreJson({ error: "Přihlaste se prosím." }, { status: 401 });
  const siteId = siteIdSchema.safeParse((await context.params).siteId);
  if (!siteId.success) return noStoreJson({ error: "Neplatná elektrárna." }, { status: 400 });
  try {
    return noStoreJson({ historyImport: await latestHistoryImport(Number(session.user.id), siteId.data) });
  } catch (error) {
    return energyErrorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }) {
  const session = await apiUser();
  if (!session) return noStoreJson({ error: "Přihlaste se prosím." }, { status: 401 });
  const [params, raw] = await Promise.all([context.params, request.json().catch(() => ({}))]);
  const siteId = siteIdSchema.safeParse(params.siteId);
  const input = requestSchema.safeParse(raw);
  if (!siteId.success || !input.success) return noStoreJson({ error: "Požadavek na import není platný." }, { status: 400 });
  const userId = Number(session.user.id);
  const rate = await consumeRateLimit(request, { scope: "energy-history-import", identity: `${userId}:${siteId.data}`, includeAddress: false, limit: 3, windowMs: 60 * 60_000 });
  if (!rate.allowed) return noStoreJson({ error: "Import lze spustit nejvýše třikrát za hodinu." }, { status: 429 });
  try {
    // A manual request asks the backend for its gaps again (and re-evaluates
    // whether the cloud has anything more) before importing; when that path
    // does not import on its own, import the requested range directly.
    const refreshed = await refreshSiteHistoryIfSparse(userId, siteId.data, "MANUAL");
    const historyImport =
      refreshed.status === "REQUESTED"
        ? await latestHistoryImport(userId, siteId.data)
        : await requestHistoryImport(userId, siteId.data, input.data.days);
    return noStoreJson({ historyImport, closed: refreshed.status === "REQUESTED" ? refreshed.closed : false }, { status: 202 });
  } catch (error) {
    return energyErrorResponse(error);
  }
}
