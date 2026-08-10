import { NextRequest, NextResponse } from "next/server";

import { apiAdmin } from "@/lib/auth/guards";
import { invoiceReviewSchema, reviewEnergyInvoice } from "@/lib/energy/invoice-review";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await apiAdmin();
  if (!session) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const parsed = invoiceReviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  try {
    const invoiceRequest = await reviewEnergyInvoice(Number(session.user.id), (await params).id, parsed.data);
    return NextResponse.json({ invoiceRequest });
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVOICE_REVIEW_FAILED";
    const status = code === "INVOICE_REQUEST_NOT_FOUND" ? 404 : ["INVOICE_DOCUMENT_MISMATCH", "INVALID_BILLING_PERIOD"].includes(code) ? 400 : 500;
    return NextResponse.json({ error: code }, { status });
  }
}
