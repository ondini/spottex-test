import { z } from "zod";

import { apiUser } from "@/lib/auth/guards";
import {
  analysisRequestSchema,
  getAnalysisWorkspace,
  queueAnalysisPreparation,
} from "@/lib/analysis/service";
import { consumeRateLimit } from "@/lib/security/rate-limit";

function json(body: unknown, init?: ResponseInit) {
  return Response.json(body, {
    ...init,
    headers: { "Cache-Control": "no-store", ...init?.headers },
  });
}

export async function GET(request: Request) {
  const session = await apiUser();
  if (!session) return json({ error: "UNAUTHORIZED" }, { status: 401 });
  const requestedSiteId = Number(new URL(request.url).searchParams.get("siteId"));
  return json(
    await getAnalysisWorkspace(
      Number(session.user.id),
      Number.isInteger(requestedSiteId) && requestedSiteId > 0
        ? requestedSiteId
        : undefined,
    ),
  );
}

export async function POST(request: Request) {
  const session = await apiUser();
  if (!session) return json({ error: "UNAUTHORIZED" }, { status: 401 });
  const userId = Number(session.user.id);
  const rate = await consumeRateLimit(request, {
    scope: "energy-analysis-v2",
    identity: userId,
    includeAddress: false,
    limit: 5,
    windowMs: 60 * 60_000,
  });
  if (!rate.allowed)
    return json(
      { error: "Další analýzu můžete zadat později." },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      },
    );
  try {
    const parsed = analysisRequestSchema.parse(
      await request.json().catch(() => null),
    );
    const requestJob = await queueAnalysisPreparation(userId, parsed);
    return json(
      { request: { id: requestJob.id, status: requestJob.status } },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof z.ZodError)
      return json({ error: "Zkontrolujte zadané varianty." }, { status: 400 });
    const code = error instanceof Error ? error.message : "ANALYSIS_FAILED";
    const messages: Record<string, [number, string]> = {
      ANALYSIS_SITE_NOT_FOUND: [404, "Elektrárna nebyla nalezena."],
      ANALYSIS_HISTORY_INSUFFICIENT: [
        422,
        "Nejdřív potřebujeme dostatečnou společnou historii výroby a spotřeby v 15minutových intervalech.",
      ],
      ANALYSIS_PROFILE_UNCONFIRMED: [
        422,
        "Nejdřív doplňte a potvrďte technické údaje elektrárny.",
      ],
      ANALYSIS_PRICE_CURVES_MISSING: [
        422,
        "Pro celé měřené období zatím nemáme ověřený cenový scénář. Nahrajte fakturu nebo počkejte na schválení katalogu.",
      ],
      ANALYSIS_BREAKER_FEE_MISSING: [
        422,
        "Pro vybraný jistič chybí publikovaný distribuční poplatek.",
      ],
      ANALYSIS_FUNDING_VERSION_INVALID: [
        422,
        "Vybraná dotace nebo financování už nejsou platné a publikované. Obnovte stránku a vyberte aktuální program.",
      ],
      ANALYSIS_INVESTMENT_INPUT_INVALID: [
        422,
        "Částka nebo splatnost financování jsou mimo podmínky vybraného programu.",
      ],
    };
    const [status, message] = messages[code] ?? [
      500,
      "Analýzu se nepodařilo připravit.",
    ];
    return json({ error: message, code }, { status });
  }
}
