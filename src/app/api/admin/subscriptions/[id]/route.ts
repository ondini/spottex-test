import { NextRequest, NextResponse } from "next/server";

import { apiAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import {
  enqueueInverterDeactivationJob,
  processInverterDeactivationJobs,
} from "@/lib/energy/deactivation-jobs";

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await apiAdmin();
  if (!session) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const id = (await params).id;
  const current = await prisma.subscription.findUnique({ where: { id }, select: { id: true, status: true, userId: true } });
  if (!current) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!["ACTIVE", "TRIAL"].includes(current.status)) return NextResponse.json({ error: "NOT_ACTIVE" }, { status: 409 });
  const job = await prisma.$transaction(async (tx) => {
    const updated = await tx.subscription.updateMany({
      where: { id, status: { in: ["ACTIVE", "TRIAL"] } },
      data: { status: "CANCELED", canceledAt: new Date(), endsAt: new Date() },
    });
    if (!updated.count) return null;
    await tx.auditLog.create({ data: { actorUserId: Number(session.user.id), action: "SUBSCRIPTION_CANCELED_BY_ADMIN", entityType: "Subscription", entityId: id } });
    return enqueueInverterDeactivationJob(tx, {
      userId: current.userId,
      reason: `admin-cancel-${id}`,
      idempotencyKey: `subscription-admin-cancel:${id}`,
    });
  });
  if (!job) return NextResponse.json({ error: "NOT_ACTIVE" }, { status: 409 });
  const processed = await processInverterDeactivationJobs({ jobIds: [job.id], limit: 1 }).catch(() => null);
  const outcome = processed?.outcomes.find((item) => item.jobId === job.id);
  const confirmed = outcome?.status === "SUCCEEDED";
  return NextResponse.json(
    {
      ok: true,
      deactivation: {
        jobId: job.id,
        confirmed,
        attempted: outcome?.attempted ?? 0,
        failed: confirmed ? 0 : 1,
      },
    },
    { status: confirmed ? 200 : 202 },
  );
}
