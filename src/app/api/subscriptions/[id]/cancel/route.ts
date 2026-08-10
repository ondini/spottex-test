import { NextRequest, NextResponse } from "next/server";

import { apiUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import {
  enqueueInverterDeactivationJob,
  processInverterDeactivationJobs,
} from "@/lib/energy/deactivation-jobs";

export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await apiUser();
  if (!session) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const id = (await params).id;
  const userId = Number(session.user.id);
  const cancellation = await prisma.$transaction(async (tx) => {
    const updated = await tx.subscription.updateMany({
      where: { id, userId, status: { in: ["ACTIVE", "TRIAL"] } },
      data: { status: "CANCELED", canceledAt: new Date(), endsAt: new Date() },
    });
    if (updated.count) await tx.auditLog.create({ data: { actorUserId: userId, action: "SUBSCRIPTION_CANCELED_BY_USER", entityType: "Subscription", entityId: id } });
    const job = updated.count
      ? await enqueueInverterDeactivationJob(tx, {
          userId,
          reason: `user-cancel-${id}`,
          idempotencyKey: `subscription-user-cancel:${id}`,
        })
      : null;
    return { changed: updated.count, job };
  });
  if (!cancellation.changed || !cancellation.job) {
    return NextResponse.json({ error: "NOT_ACTIVE" }, { status: 409 });
  }
  const processed = await processInverterDeactivationJobs({
    jobIds: [cancellation.job.id],
    limit: 1,
  }).catch(() => null);
  const outcome = processed?.outcomes.find((item) => item.jobId === cancellation.job?.id);
  const confirmed = outcome?.status === "SUCCEEDED";
  return NextResponse.json(
    {
      ok: true,
      deactivation: {
        jobId: cancellation.job.id,
        confirmed,
        attempted: outcome?.attempted ?? 0,
        failed: confirmed ? 0 : 1,
      },
    },
    { status: confirmed ? 200 : 202 },
  );
}
