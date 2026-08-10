import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiUser } from "@/lib/auth/guards";
import { finalizePaidPayment } from "@/lib/commerce/payment";
import { prisma } from "@/lib/prisma";

const schema = z.object({ paymentId: z.string().min(1) });

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production" || (process.env.PAYMENT_PROVIDER || "MOCK") !== "MOCK") {
    return NextResponse.json({ error: "NOT_AVAILABLE" }, { status: 404 });
  }
  const session = await apiUser();
  if (!session) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const payment = await prisma.payment.findFirst({ where: { id: parsed.data.paymentId, userId: Number(session.user.id), provider: "MOCK" } });
  if (!payment) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  await finalizePaidPayment(payment.id, { mock: true });
  return NextResponse.json({ ok: true });
}
