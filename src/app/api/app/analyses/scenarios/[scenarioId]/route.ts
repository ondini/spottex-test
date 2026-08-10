import { getAnalysisScenarioDetail } from "@/lib/analysis/detail";
import { apiUser } from "@/lib/auth/guards";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ scenarioId: string }> },
) {
  const session = await apiUser();
  if (!session)
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    return Response.json(
      await getAnalysisScenarioDetail(
        Number(session.user.id),
        (await params).scenarioId,
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const code =
      error instanceof Error ? error.message : "ANALYSIS_DETAIL_FAILED";
    return Response.json(
      { error: code },
      { status: code === "ANALYSIS_SCENARIO_NOT_FOUND" ? 404 : 500 },
    );
  }
}
