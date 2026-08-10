import { prisma } from "@/lib/prisma";

export async function hasInverterControlEntitlement(userId: number, now = new Date()) {
  const subscription = await prisma.subscription.findFirst({
    where: {
      userId,
      user: { status: "ACTIVE" },
      product: { code: "INVERTER_CONTROL", active: true },
      status: { in: ["ACTIVE", "TRIAL"] },
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
    select: { id: true, status: true, source: true, endsAt: true },
    orderBy: { endsAt: "desc" },
  });
  return subscription;
}
