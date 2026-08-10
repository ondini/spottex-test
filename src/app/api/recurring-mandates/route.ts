import { NextResponse } from "next/server";

import { apiUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await apiUser();
  if (!session) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const mandates = await prisma.recurringPaymentMandate.findMany({
    where: { userId: Number(session.user.id) },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      provider: true,
      status: true,
      currency: true,
      maxAmountMinor: true,
      renewalPeriodDays: true,
      noticeDays: true,
      consentedAt: true,
      validUntil: true,
      revokedAt: true,
      renewals: {
        orderBy: { scheduledAt: "desc" },
        take: 1,
        select: { status: true, amountMinor: true, scheduledAt: true, noticeSentAt: true },
      },
    },
  });
  return NextResponse.json({ mandates });
}
