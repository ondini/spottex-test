import { NextResponse } from "next/server";

import { apiUser } from "@/lib/auth/guards";
import { readEnergyInvoiceDocument } from "@/lib/energy/invoice-document";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const session = await apiUser();
  if (!session) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    const document = await readEnergyInvoiceDocument(Number(session.user.id), session.user.role, (await context.params).id);
    const encodedName = encodeURIComponent(document.fileName);
    return new NextResponse(new Uint8Array(document.bytes), {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Type": document.mimeType,
        "Content-Length": String(document.bytes.length),
        "Content-Disposition": `attachment; filename="faktura"; filename*=UTF-8''${encodedName}`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "DOCUMENT_NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
