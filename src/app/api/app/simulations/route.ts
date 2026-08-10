import { z } from "zod";

import { apiUser } from "@/lib/auth/guards";
import {
  enqueueSimulation,
  getSimulationWorkspace,
  simulationInputSchema,
} from "@/lib/simulation/service";
import { consumeRateLimit } from "@/lib/security/rate-limit";

function json(body: unknown, init?: ResponseInit) {
  return Response.json(body, { ...init, headers: { "Cache-Control": "no-store", ...init?.headers } });
}

export async function GET() {
  const session = await apiUser();
  if (!session) return json({ error: "Přihlaste se prosím." }, { status: 401 });
  return json(await getSimulationWorkspace(Number(session.user.id)));
}

export async function POST(request: Request) {
  const session = await apiUser();
  if (!session) return json({ error: "Přihlaste se prosím." }, { status: 401 });
  const userId = Number(session.user.id);
  const rate = await consumeRateLimit(request, {
    scope: "energy-simulation-user",
    identity: userId,
    includeAddress: false,
    limit: 5,
    windowMs: 60 * 60_000,
  });
  if (!rate.allowed) {
    return json(
      { error: "Další výpočet můžete zadat později." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }
  const parsed = simulationInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Zkontrolujte parametry simulace." }, { status: 400 });
  try {
    return json({ job: await enqueueSimulation(userId, parsed.data) }, { status: 202 });
  } catch (error) {
    if (error instanceof Error && error.message === "SIMULATION_SITE_NOT_FOUND") {
      return json({ error: "Elektrárna nebyla nalezena." }, { status: 404 });
    }
    if (error instanceof Error && error.message === "SIMULATION_HISTORY_INSUFFICIENT") {
      return json({ error: "Historie ještě není dostatečně úplná. Počkejte na import alespoň sedmi dní 15minutových dat." }, { status: 422 });
    }
    if (error instanceof z.ZodError) return json({ error: "Zkontrolujte parametry simulace." }, { status: 400 });
    return json({ error: "Výpočet se nepodařilo zařadit." }, { status: 500 });
  }
}
