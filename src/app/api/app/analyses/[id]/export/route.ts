import { exportProAnalysisCsv } from "@/lib/analysis/export";
import { apiUser } from "@/lib/auth/guards";
import { consumeRateLimit } from "@/lib/security/rate-limit";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await apiUser();
  if (!session) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const userId = Number(session.user.id);
  const rate = await consumeRateLimit(request, { scope: "analysis-export", identity: userId, includeAddress: false, limit: 20, windowMs: 60 * 60_000 });
  if (!rate.allowed) return Response.json({ error: "RATE_LIMITED" }, { status: 429 });
  try {
    const id = (await params).id;
    const csv = await exportProAnalysisCsv(userId, id);
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="spottex-analyza-${id}.csv"`, "Cache-Control": "private, no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "PRO_ANALYSIS_EXPORT_FAILED";
    return Response.json({ error: code }, { status: code === "PRO_ANALYSIS_EXPORT_NOT_FOUND" ? 404 : 500 });
  }
}
