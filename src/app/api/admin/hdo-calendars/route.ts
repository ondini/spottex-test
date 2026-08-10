import { NextResponse } from "next/server";

import { apiAdmin } from "@/lib/auth/guards";
import { exactHdoCalendarSchema, importExactHdoCalendar } from "@/lib/pricing/hdo-calendar";

export async function POST(request: Request) {
  const session = await apiAdmin();
  if (!session) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const parsed = exactHdoCalendarSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  try {
    const calendar = await importExactHdoCalendar(Number(session.user.id), parsed.data);
    return NextResponse.json({ calendar: { id: calendar.id } }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "HDO_IMPORT_FAILED";
    const status = code === "HDO_SITE_NOT_FOUND" ? 404 : code.startsWith("HDO_") ? 400 : 500;
    return NextResponse.json({ error: code }, { status });
  }
}
