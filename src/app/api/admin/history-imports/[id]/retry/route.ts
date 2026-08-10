import { NextResponse } from "next/server";

import { apiAdmin } from "@/lib/auth/guards";
import { retryHistoryImport } from "@/lib/energy/history-import";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await apiAdmin();
  if (!session) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  try {
    return NextResponse.json({ historyImport: await retryHistoryImport(Number(session.user.id), (await params).id) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "HISTORY_IMPORT_RETRY_FAILED";
    return NextResponse.json({ error: code }, { status: code === "HISTORY_IMPORT_NOT_FOUND" ? 404 : 409 });
  }
}
