import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiAdmin } from "@/lib/auth/guards";
import { activatePromo } from "@/lib/commerce/promo";

const schema = z.object({ userId: z.number().int().positive(), days: z.number().int().min(1).max(730), reason: z.string().trim().min(3).max(500) });

export async function POST(request: NextRequest) {
  const session = await apiAdmin();
  if (!session) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  try {
    const subscription = await activatePromo({ ...parsed.data, adminId: Number(session.user.id) });
    return NextResponse.json({ subscription }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "PROMO_FAILED" }, { status: 409 });
  }
}
