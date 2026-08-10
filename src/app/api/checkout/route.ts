import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiUser } from "@/lib/auth/guards";
import { createCheckout } from "@/lib/commerce/payment";

const schema = z.object({
  cartId: z.string().min(1),
  recurringConsent: z.literal(true).optional(),
});

export async function POST(request: NextRequest) {
  const session = await apiUser();
  if (!session) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  try {
    return NextResponse.json(await createCheckout(Number(session.user.id), parsed.data.cartId, {
      recurringConsent: parsed.data.recurringConsent,
    }), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "CHECKOUT_FAILED" }, { status: 409 });
  }
}
