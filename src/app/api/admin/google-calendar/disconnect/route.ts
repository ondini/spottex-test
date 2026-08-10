import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { apiAdmin } from "@/lib/auth/guards";
import {
  isCalendarDisconnectOperation,
  lockHostCalendarState,
  stableCalendarMetadata,
  stageCalendarDisconnect,
} from "@/lib/consultation/calendar-state";
import { CALENDAR_DELETE_JOB } from "@/lib/consultation/calendar-sync";
import { revokeGoogleCalendarGrant } from "@/lib/consultation/google-calendar";
import { decryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

async function releaseDisconnectStage(hostUserId: number, operationId: string) {
  await prisma.$transaction(async (tx) => {
    const calendar = await lockHostCalendarState(tx, hostUserId);
    if (!calendar || !isCalendarDisconnectOperation(calendar.metadata, operationId)) return;
    // Keep oauthDisconnectEpoch. A failed network attempt must never make an
    // OAuth state issued before the disconnect valid again.
    await tx.consultationHostCalendar.update({
      where: { id: calendar.id },
      data: { metadata: stableCalendarMetadata(calendar.metadata) },
    });
  });
}

export async function POST() {
  const session = await apiAdmin();
  if (!session) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const hostUserId = Number(session.user.id);
  const now = new Date();
  const staged = await prisma.$transaction(async (tx) => {
    const calendar = await lockHostCalendarState(tx, hostUserId);
    const [activeBookings, pendingDeletes] = await Promise.all([
      tx.consultationSlot.count({
        where: {
          hostUserId,
          startUtc: { gt: now },
          OR: [
            { status: "BOOKED", OR: [{ googleEventId: { not: null } }, { bookings: { some: { status: "CONFIRMED" } } }] },
            { status: "HELD", bookings: { some: { status: "PENDING" } } },
          ],
        },
      }),
      tx.scheduledJob.count({
        where: {
          type: CALENDAR_DELETE_JOB,
          status: { in: ["PENDING", "RUNNING", "FAILED"] },
          payload: { path: ["hostUserId"], equals: hostUserId },
        },
      }),
    ]);
    if (activeBookings || pendingDeletes) {
      return { blocked: true as const, activeBookings, pendingDeletes };
    }

    const stage = stageCalendarDisconnect(calendar?.metadata, randomUUID(), now);
    if (calendar) {
      await tx.consultationHostCalendar.update({
        where: { id: calendar.id },
        data: { metadata: stage.metadata },
      });
    } else {
      await tx.consultationHostCalendar.create({
        data: { hostUserId, metadata: stage.metadata },
      });
    }
    return {
      blocked: false as const,
      operationId: stage.operationId,
      encryptedGrantToken: calendar?.encryptedRefreshToken || calendar?.encryptedAccessToken || null,
    };
  });
  if (staged.blocked) {
    return NextResponse.json({
      error: "ACTIVE_CALENDAR_DEPENDENCIES",
      activeBookings: staged.activeBookings,
      pendingJobs: staged.pendingDeletes,
    }, { status: 409 });
  }

  let providerResult: "REVOKED" | "ALREADY_REVOKED" | "NO_LOCAL_GRANT" = "NO_LOCAL_GRANT";
  try {
    if (staged.encryptedGrantToken) {
      providerResult = await revokeGoogleCalendarGrant(decryptSecret(staged.encryptedGrantToken));
    }
  } catch (error) {
    console.error("Google Calendar grant revocation failed", error);
    await releaseDisconnectStage(hostUserId, staged.operationId);
    return NextResponse.json({ error: "GOOGLE_REVOCATION_FAILED" }, { status: 502 });
  }

  const finalized = await prisma.$transaction(async (tx) => {
    const calendar = await lockHostCalendarState(tx, hostUserId);
    if (!calendar) return "RETRY" as const;
    if (!isCalendarDisconnectOperation(calendar.metadata, staged.operationId)) {
      // A concurrent retry may already have completed this exact operation.
      if (!calendar.encryptedAccessToken && !calendar.encryptedRefreshToken) return "ALREADY_DONE" as const;
      return "RETRY" as const;
    }
    await tx.consultationHostCalendar.update({
      where: { id: calendar.id },
      data: {
        googleEmail: null,
        encryptedAccessToken: null,
        encryptedRefreshToken: null,
        tokenExpiresAt: null,
        metadata: stableCalendarMetadata(calendar.metadata),
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: hostUserId,
        action: "GOOGLE_CALENDAR_DISCONNECTED",
        entityType: "ConsultationHostCalendar",
        entityId: String(calendar.id),
        metadata: { providerResult },
      },
    });
    return "DONE" as const;
  });
  if (finalized === "RETRY") {
    return NextResponse.json({ error: "DISCONNECT_RETRY_REQUIRED" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
