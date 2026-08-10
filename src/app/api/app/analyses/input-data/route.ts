import { z } from "zod";

import { getAnalysisInputSeries } from "@/lib/analysis/detail";
import { apiUser } from "@/lib/auth/guards";

export async function GET(request: Request) {
  const session = await apiUser();
  if (!session)
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const url = new URL(request.url);
  const parsed = z.coerce
    .number()
    .int()
    .positive()
    .safeParse(url.searchParams.get("siteId"));
  if (!parsed.success)
    return Response.json({ error: "INVALID_SITE" }, { status: 400 });
  try {
    const startedAt = performance.now();
    const resolution = z
      .enum(["WEEK", "DAY", "HOUR", "15MIN"])
      .catch("WEEK")
      .parse(url.searchParams.get("resolution") ?? "WEEK");
    const fromValue = url.searchParams.get("from");
    const toValue = url.searchParams.get("to");
    const from = fromValue ? new Date(fromValue) : undefined;
    const to = toValue ? new Date(toValue) : undefined;
    if (
      (from && Number.isNaN(from.getTime())) ||
      (to && Number.isNaN(to.getTime())) ||
      (from && to && (from >= to || to.getTime() - from.getTime() > 367 * 86_400_000))
    ) {
      return Response.json({ error: "INVALID_RANGE" }, { status: 400 });
    }
    const payload = await getAnalysisInputSeries(
      Number(session.user.id),
      parsed.data,
      {
        from,
        to,
        resolution,
      },
    );
    return Response.json(payload, {
      headers: {
        "Cache-Control": "private, max-age=30, stale-while-revalidate=120",
        "Server-Timing": `history;dur=${(performance.now() - startedAt).toFixed(1)}`,
      },
    });
  } catch (error) {
    const code =
      error instanceof Error ? error.message : "ANALYSIS_INPUT_DATA_FAILED";
    return Response.json(
      { error: code },
      { status: code === "ANALYSIS_SITE_NOT_FOUND" ? 404 : 500 },
    );
  }
}
