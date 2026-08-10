import { NextRequest } from "next/server";

import { apiUser } from "@/lib/auth/guards";
import { energyErrorResponse, noStoreJson } from "@/lib/energy/http";
import { getEnergyDashboard } from "@/lib/energy/service";
import { LegacySpottexClient } from "@/lib/energy/legacy-client";
import { EnergyError } from "@/lib/energy/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await apiUser();
  if (!session) return noStoreJson({ error: "Přihlaste se prosím." }, { status: 401 });

  const rawSiteId = request.nextUrl.searchParams.get("siteId");
  const siteId = rawSiteId === null ? null : Number(rawSiteId);
  if (siteId !== null && (!Number.isInteger(siteId) || siteId <= 0)) {
    return energyErrorResponse(new EnergyError("INVALID_REQUEST", "Neplatná elektrárna.", 400));
  }

  try {
    const snapshot = await getEnergyDashboard(Number(session.user.id), siteId);
    return noStoreJson({ snapshot });
  } catch (error) {
    if (error instanceof EnergyError && error.code === "NO_SITES") {
      return noStoreJson(
        {
          error: error.message,
          code: error.code,
          connectorConfigured: LegacySpottexClient.isConfigured(),
        },
        { status: error.status },
      );
    }
    return energyErrorResponse(error);
  }
}
