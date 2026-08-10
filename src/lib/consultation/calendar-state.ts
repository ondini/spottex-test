import type { Prisma } from "@prisma/client";

export type CalendarStateClient = Pick<Prisma.TransactionClient, "$executeRaw" | "consultationHostCalendar">;

export function calendarMetadata(value: Prisma.JsonValue | null | undefined): Prisma.JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Prisma.JsonObject : {};
}

export function isCalendarDisconnecting(value: Prisma.JsonValue | null | undefined) {
  return calendarMetadata(value).disconnecting === true;
}

export function calendarDisconnectEpoch(value: Prisma.JsonValue | null | undefined): number {
  const epoch = calendarMetadata(value).oauthDisconnectEpoch;
  return typeof epoch === "number" && Number.isSafeInteger(epoch) && epoch >= 0 ? epoch : 0;
}

export function isCurrentCalendarOAuthState(
  value: Prisma.JsonValue | null | undefined,
  disconnectEpoch: number,
) {
  return !isCalendarDisconnecting(value) && calendarDisconnectEpoch(value) === disconnectEpoch;
}

export type CalendarDisconnectStage = {
  metadata: Prisma.JsonObject;
  operationId: string;
  disconnectEpoch: number;
};

export function stageCalendarDisconnect(
  value: Prisma.JsonValue | null | undefined,
  operationId: string,
  now: Date,
): CalendarDisconnectStage {
  const metadata = calendarMetadata(value);
  const existingOperationId = metadata.disconnectOperationId;
  if (metadata.disconnecting === true && typeof existingOperationId === "string" && existingOperationId.length > 0) {
    return {
      metadata,
      operationId: existingOperationId,
      disconnectEpoch: calendarDisconnectEpoch(metadata),
    };
  }
  const disconnectEpoch = calendarDisconnectEpoch(metadata) + 1;
  return {
    metadata: {
      ...stableCalendarMetadata(metadata),
      oauthDisconnectEpoch: disconnectEpoch,
      disconnecting: true,
      disconnectingAt: now.toISOString(),
      disconnectOperationId: operationId,
    },
    operationId,
    disconnectEpoch,
  };
}

export function isCalendarDisconnectOperation(
  value: Prisma.JsonValue | null | undefined,
  operationId: string,
) {
  const metadata = calendarMetadata(value);
  return metadata.disconnecting === true && metadata.disconnectOperationId === operationId;
}

export function stableCalendarMetadata(value: Prisma.JsonValue | null | undefined): Prisma.JsonObject {
  const stable = { ...calendarMetadata(value) };
  delete stable.disconnecting;
  delete stable.disconnectingAt;
  delete stable.disconnectOperationId;
  return stable;
}

export async function lockHostCalendarState(tx: CalendarStateClient, hostUserId: number) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(78105::int, ${hostUserId}::int)`;
  return tx.consultationHostCalendar.findUnique({
    where: { hostUserId },
    select: {
      id: true,
      metadata: true,
      targetCalendarId: true,
      autoMeet: true,
      encryptedAccessToken: true,
      encryptedRefreshToken: true,
    },
  });
}
