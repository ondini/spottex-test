import { NextResponse } from "next/server";

import { createProAnalysisCheckout } from "@/lib/analysis/pro-checkout";
import { apiUser } from "@/lib/auth/guards";
import { consumeRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await apiUser();
  if (!session) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const userId = Number(session.user.id);
  const rate = await consumeRateLimit(request, { scope: "pro-analysis-checkout", identity: userId, includeAddress: false, limit: 10, windowMs: 60 * 60_000 });
  if (!rate.allowed) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  try {
    return NextResponse.json(await createProAnalysisCheckout(userId, (await params).id), { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "PRO_CHECKOUT_FAILED";
    return NextResponse.json({ error: code }, { status: code === "PRO_ANALYSIS_NOT_FOUND" ? 404 : 409 });
  }
}
