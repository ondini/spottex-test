import { NextRequest, NextResponse } from "next/server";

import { apiUser } from "@/lib/auth/guards";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { revokeRecurringMandate } from "@/lib/commerce/recurring";

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await apiUser();
  if (!session) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const limited = await consumeRateLimit(request, {
    scope: "recurring-mandate-revoke",
    identity: session.user.id,
    includeAddress: false,
    limit: 5,
    windowMs: 60 * 60_000,
  });
  if (!limited.allowed) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  const { id } = await context.params;
  try {
    const result = await revokeRecurringMandate(Number(session.user.id), id);
    return NextResponse.json({
      status: "REVOKED",
      providerConfirmed: result.providerConfirmed,
      message: result.providerConfirmed
        ? "Opakovaná platba byla zrušena i u GoPay."
        : "Další stržení jsme ve Spottexu okamžitě zakázali. Potvrzení od GoPay ještě vyžaduje kontrolu.",
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "RECURRING_MANDATE_REVOKE_FAILED";
    return NextResponse.json({ error: code }, { status: code === "RECURRING_MANDATE_NOT_FOUND" ? 404 : 503 });
  }
}
