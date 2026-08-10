import "server-only";

import { z } from "zod";

import { supersedeSiteAnalyses } from "@/lib/analysis/invalidation";
import { prisma } from "@/lib/prisma";

const intervalSchema = z.object({
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
}).strict();

export const exactHdoCalendarSchema = z.object({
  energySiteId: z.number().int().positive(),
  validFrom: z.string().datetime({ offset: true }),
  validTo: z.string().datetime({ offset: true }),
  sourceReference: z.string().url().max(1_000),
  intervals: z.array(intervalSchema).min(1).max(10_000),
}).strict();

export async function importExactHdoCalendar(actorUserId: number, raw: unknown) {
  const input = exactHdoCalendarSchema.parse(raw);
  const validFrom = new Date(input.validFrom);
  const validTo = new Date(input.validTo);
  if (validTo <= validFrom) throw new Error("HDO_INVALID_VALIDITY");
  const site = await prisma.energySite.findUnique({ where: { id: input.energySiteId }, include: { technicalProfile: true } });
  if (!site) throw new Error("HDO_SITE_NOT_FOUND");
  if (!site.ean || !site.technicalProfile?.distributorCode) throw new Error("HDO_SITE_IDENTITY_MISSING");
  const intervals = input.intervals.map((item) => ({ startAt: new Date(item.startAt), endAt: new Date(item.endAt) })).sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
  let previousEnd = validFrom.getTime();
  for (const interval of intervals) {
    const start = interval.startAt.getTime();
    const end = interval.endAt.getTime();
    if (start < validFrom.getTime() || end > validTo.getTime() || end <= start || start % 900_000 !== 0 || end % 900_000 !== 0 || start < previousEnd) throw new Error("HDO_INTERVALS_INVALID");
    previousEnd = end;
  }
  return prisma.$transaction(async (tx) => {
    const calendar = await tx.energyHdoCalendar.create({
      data: {
        energySiteId: site.id,
        validFrom,
        validTo,
        source: "DISTRIBUTOR",
        exact: true,
        confidencePct: 100,
        sourceReference: input.sourceReference,
        eanSnapshot: site.ean,
        distributorCode: site.technicalProfile!.distributorCode,
        timezone: site.timezone,
        retrievedAt: new Date(),
        verifiedAt: new Date(),
        intervals: { createMany: { data: intervals.map((interval) => ({ ...interval, lowTariff: true })) } },
      },
    });
    const supersededCurves = await tx.energyPriceCurve.updateMany({
      where: { energySiteId: site.id, hdoCalendarId: null, status: { in: ["DRAFT", "READY"] }, validFrom: { lt: validTo }, validTo: { gt: validFrom } },
      data: { status: "SUPERSEDED" },
    });
    const analyses = await supersedeSiteAnalyses(tx, { energySiteId: site.id, actorUserId, reason: "Byl doplněn přesný kalendář HDO. Modelové cenové křivky a výsledky už nejsou aktuální." });
    await tx.auditLog.create({
      data: {
        actorUserId,
        action: "ENERGY_HDO_CALENDAR_IMPORTED",
        entityType: "EnergyHdoCalendar",
        entityId: calendar.id,
        metadata: { energySiteId: site.id, ean: site.ean, distributorCode: site.technicalProfile!.distributorCode, validFrom: input.validFrom, validTo: input.validTo, intervalCount: intervals.length, sourceReference: input.sourceReference, supersededCurves: supersededCurves.count, supersededAnalyses: analyses.superseded },
      },
    });
    return calendar;
  }, { maxWait: 5_000, timeout: 30_000 });
}
