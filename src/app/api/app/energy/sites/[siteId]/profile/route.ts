import { z } from "zod";

import { apiUser } from "@/lib/auth/guards";
import { energyErrorResponse, noStoreJson } from "@/lib/energy/http";
import {
  getTechnicalProfileWorkspace,
  technicalProfilePatchSchema,
  updateTechnicalProfile,
} from "@/lib/energy/technical-profile";
import { consumeRateLimit } from "@/lib/security/rate-limit";

const siteIdSchema = z.coerce.number().int().positive();

export async function GET(
  _request: Request,
  context: { params: Promise<{ siteId: string }> },
) {
  const session = await apiUser();
  if (!session) return noStoreJson({ error: "Přihlaste se prosím." }, { status: 401 });
  const parsedSiteId = siteIdSchema.safeParse((await context.params).siteId);
  if (!parsedSiteId.success) return noStoreJson({ error: "Neplatná elektrárna." }, { status: 400 });
  try {
    const workspace = await getTechnicalProfileWorkspace(Number(session.user.id), parsedSiteId.data);
    return noStoreJson({ workspace });
  } catch (error) {
    return energyErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ siteId: string }> },
) {
  const session = await apiUser();
  if (!session) return noStoreJson({ error: "Přihlaste se prosím." }, { status: 401 });
  const [params, body] = await Promise.all([context.params, request.json().catch(() => null)]);
  const parsedSiteId = siteIdSchema.safeParse(params.siteId);
  const parsedBody = technicalProfilePatchSchema.safeParse(body);
  if (!parsedSiteId.success || !parsedBody.success) {
    return noStoreJson({ error: "Technické údaje nejsou ve správném formátu." }, { status: 400 });
  }
  const userId = Number(session.user.id);
  const limit = await consumeRateLimit(request, {
    scope: "energy-profile-update",
    identity: `${userId}:${parsedSiteId.data}`,
    includeAddress: false,
    limit: 20,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return noStoreJson({ error: "Změny ukládáte příliš rychle. Chvíli počkejte." }, { status: 429 });
  }
  try {
    const profile = await updateTechnicalProfile(userId, parsedSiteId.data, parsedBody.data);
    return noStoreJson({ profile });
  } catch (error) {
    return energyErrorResponse(error);
  }
}
