import { apiUser } from "@/lib/auth/guards";
import { cancelQueuedAnalysis } from "@/lib/analysis/service";
import { consumeRateLimit } from "@/lib/security/rate-limit";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await apiUser();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const userId = Number(session.user.id);
  const rate = await consumeRateLimit(request, { scope: "analysis-cancel", identity: userId, includeAddress: false, limit: 20, windowMs: 60_000 });
  if (!rate.allowed) return Response.json({ error: "RATE_LIMITED" }, { status: 429 });
  try {
    return Response.json({ run: await cancelQueuedAnalysis(userId, (await params).id) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "ANALYSIS_CANCEL_FAILED";
    return Response.json({ error: code }, { status: code === "ANALYSIS_NOT_FOUND" ? 404 : 409 });
  }
}
