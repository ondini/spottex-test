import { z } from "zod";

import { apiUser } from "@/lib/auth/guards";
import { energyErrorResponse, noStoreJson } from "@/lib/energy/http";
import {
  connectLegacyEnergyAccount,
  discoverLegacyEnergyPlants,
} from "@/lib/energy/service";
import { requestHistoryImport } from "@/lib/energy/history-import";
import { consumeRateLimit } from "@/lib/security/rate-limit";

const connectionSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()).optional(),
  password: z.string().min(1).max(200).optional(),
  plantId: z.string().trim().min(1).max(200).optional(),
  plantIds: z.array(z.string().trim().min(1).max(200)).min(1).max(100).optional(),
  discoveryId: z.string().trim().min(20).max(200).optional(),
});

export async function POST(request: Request) {
  const session = await apiUser();
  if (!session) return noStoreJson({ error: "Přihlaste se prosím." }, { status: 401 });
  const userId = Number(session.user.id);
  const [addressLimit, userLimit] = await Promise.all([
    consumeRateLimit(request, { scope: "energy-connect-address", limit: 20, windowMs: 15 * 60_000 }),
    consumeRateLimit(request, { scope: "energy-connect-user", identity: userId, includeAddress: false, limit: 5, windowMs: 15 * 60_000 }),
  ]);
  const limited = !addressLimit.allowed ? addressLimit : !userLimit.allowed ? userLimit : null;
  if (limited) return noStoreJson({ error: "Příliš mnoho pokusů. Zkuste to později.", code: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });

  const parsed = connectionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return noStoreJson({ error: "Zadejte platný e-mail a heslo původního účtu." }, { status: 400 });
  }

  try {
    const plantIds = parsed.data.plantIds ?? (parsed.data.plantId ? [parsed.data.plantId] : []);
    if (!plantIds.length) {
      if (!parsed.data.email || !parsed.data.password) {
        return noStoreJson({ error: "Zadejte platný e-mail a heslo účtu SolaX Cloud." }, { status: 400 });
      }
      const result = await discoverLegacyEnergyPlants({
        email: parsed.data.email,
        password: parsed.data.password,
      });
      return noStoreJson({
        ...result,
        requiresSelection: true,
        message: `Vyberte jednu nebo více z ${result.plants.length} nalezených elektráren.`,
      });
    }
    if (!parsed.data.discoveryId) {
      return noStoreJson(
        { error: "Výběr elektrárny vypršel. Načtěte seznam znovu." },
        { status: 400 },
      );
    }
    const result = await connectLegacyEnergyAccount(userId, {
      plantIds: [...new Set(plantIds)],
      discoveryId: parsed.data.discoveryId,
    });
    const historyImports = await Promise.allSettled(
      result.connectedSiteIds.map((siteId) => requestHistoryImport(userId, siteId, 365)),
    );
    const queuedHistoryImports = historyImports.filter((item) => item.status === "fulfilled").length;
    return noStoreJson({
      ...result,
      requiresSelection: false,
      queuedHistoryImports,
      message: result.connectedSiteIds.length === 1
        ? "Elektrárna je připojená. Historická data připravujeme na pozadí."
        : `${result.connectedSiteIds.length} elektráren je připojeno. Historická data připravujeme na pozadí.`,
    }, { status: 201 });
  } catch (error) {
    return energyErrorResponse(error);
  }
}
