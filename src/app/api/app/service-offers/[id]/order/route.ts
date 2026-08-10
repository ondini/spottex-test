import { NextResponse } from "next/server";

import { apiUser } from "@/lib/auth/guards";
import { prepareServiceOfferOrder } from "@/lib/commerce/service-offer-order";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await apiUser();
  if (!session) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    return NextResponse.json(await prepareServiceOfferOrder(Number(session.user.id), (await params).id), { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "SERVICE_OFFER_ORDER_FAILED";
    return NextResponse.json({ error: code }, { status: code === "SERVICE_OFFER_NOT_AVAILABLE" ? 404 : 409 });
  }
}
