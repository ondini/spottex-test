import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiAdmin } from "@/lib/auth/guards";
import {
  enqueueInverterDeactivationJob,
  processInverterDeactivationJobs,
} from "@/lib/energy/deactivation-jobs";
import { prisma } from "@/lib/prisma";

const schema = z.object({ role: z.enum(["USER", "ADMIN"]).optional(), status: z.enum(["ACTIVE", "DISABLED"]).optional() });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await apiAdmin();
  if (!session) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const userId = Number((await params).id);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!Number.isInteger(userId) || !parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('spottex-active-admins'))`;
      const target = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true, status: true, authVersion: true } });
      if (!target) throw new Error("NOT_FOUND");
      if (target.id === Number(session.user.id) && (parsed.data.role === "USER" || parsed.data.status === "DISABLED")) throw new Error("CANNOT_DISABLE_SELF");
      if (target.role === "ADMIN" && (parsed.data.role === "USER" || parsed.data.status === "DISABLED")) {
        const adminCount = await tx.user.count({ where: { role: "ADMIN", status: "ACTIVE" } });
        if (adminCount <= 1) throw new Error("LAST_ADMIN");
      }
      const updated = await tx.user.update({
        where: { id: userId },
        data: { ...parsed.data, authVersion: { increment: 1 } },
        select: { id: true, email: true, name: true, role: true, status: true, emailVerifiedAt: true, createdAt: true, updatedAt: true },
      });
      await tx.auditLog.create({ data: { actorUserId: Number(session.user.id), action: "USER_ACCESS_UPDATED", entityType: "User", entityId: String(userId), metadata: parsed.data } });
      const deactivationJob = target.status !== "DISABLED" && updated.status === "DISABLED"
        ? await enqueueInverterDeactivationJob(tx, {
          userId,
          reason: "admin-user-disabled",
          idempotencyKey: `user-disabled:${userId}:v${target.authVersion + 1}`,
        })
        : null;
      return { user: updated, deactivationJobId: deactivationJob?.id ?? null };
    });

    if (!result.deactivationJobId) return NextResponse.json({ user: result.user });

    try {
      const deactivation = await processInverterDeactivationJobs({
        jobIds: [result.deactivationJobId],
        limit: 1,
      });
      const confirmed = deactivation.outcomes.some((outcome) =>
        outcome.jobId === result.deactivationJobId && outcome.status === "SUCCEEDED",
      );
      return NextResponse.json(
        {
          user: result.user,
          deactivation,
          ...(confirmed ? {} : { warning: "DEACTIVATION_PENDING" }),
        },
        { status: confirmed ? 200 : 202 },
      );
    } catch {
      // The durable job was committed together with the disabled account and
      // will be retried by the internal runner even if the immediate attempt fails.
      return NextResponse.json(
        { user: result.user, warning: "DEACTIVATION_PENDING" },
        { status: 202 },
      );
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : "UPDATE_FAILED";
    if (code === "NOT_FOUND") return NextResponse.json({ error: code }, { status: 404 });
    if (["CANNOT_DISABLE_SELF", "LAST_ADMIN"].includes(code)) return NextResponse.json({ error: code }, { status: 409 });
    throw error;
  }
}
