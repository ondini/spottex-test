import "server-only";

import { createHash } from "node:crypto";

import { EnergyProvider } from "@prisma/client";
import { z } from "zod";

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import {
  accessTokenExpiresAt,
  LegacySpottexClient,
} from "@/lib/energy/legacy-client";
import { prisma } from "@/lib/prisma";

const legacySourceUrl =
  "https://www.ote-cr.cz/cs/kratkodobe-trhy/elektrina/denni-trh?time_resolution=PT15M";

export type OteMarketInterval = {
  startAt: Date;
  endAt: Date;
  priceCzkMwh: number;
  predicted: boolean;
};

export async function publishOteMarketSeries(input: {
  intervals: OteMarketInterval[];
  sourceUrl: string;
  requiredFrom?: Date;
  requiredTo?: Date;
}) {
  const rows = input.intervals
    .filter(
      (point) =>
        Number.isFinite(point.priceCzkMwh) &&
        point.endAt.getTime() - point.startAt.getTime() === 15 * 60_000,
    )
    .sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
  const byStart = new Map<number, OteMarketInterval>();
  for (const point of rows) {
    const key = point.startAt.getTime();
    const previous = byStart.get(key);
    if (!previous || (previous.predicted && !point.predicted)) {
      byStart.set(key, point);
    }
  }
  const uniqueRows = [...byStart.values()];
  if (uniqueRows.length < 96) return null;
  const validFrom = uniqueRows[0].startAt;
  const validTo = uniqueRows.at(-1)!.endAt;
  if (
    (input.requiredFrom && validFrom > input.requiredFrom) ||
    (input.requiredTo && validTo < input.requiredTo)
  ) {
    return null;
  }

  const normalized: OteMarketInterval[] = [];
  let previous = uniqueRows[0];
  for (
    let timestamp = validFrom.getTime();
    timestamp < validTo.getTime();
    timestamp += 15 * 60_000
  ) {
    const current = byStart.get(timestamp);
    if (current) previous = current;
    normalized.push({
      startAt: new Date(timestamp),
      endAt: new Date(timestamp + 15 * 60_000),
      priceCzkMwh: current?.priceCzkMwh ?? previous.priceCzkMwh,
      // A filled interval is an estimate even when its nearest predecessor was
      // a confirmed market value.
      predicted: current?.predicted ?? true,
    });
  }
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        sourceUrl: input.sourceUrl,
        validFrom: validFrom.toISOString(),
        validTo: validTo.toISOString(),
        normalized,
      }),
    )
    .digest("hex");
  const same = await prisma.marketPriceSeries.findFirst({
    where: { sourceSha256: fingerprint },
  });
  if (same?.status === "PUBLISHED") {
    return prisma.marketPriceSeries.update({
      where: { id: same.id },
      data: { status: "PUBLISHED" },
    });
  }

  return prisma.$transaction(
    async (tx) => {
      await tx.marketPriceSeries.updateMany({
        where: { market: "OTE_DAY_AHEAD", status: "PUBLISHED" },
        data: { status: "ARCHIVED" },
      });
      if (same) {
        return tx.marketPriceSeries.update({
          where: { id: same.id },
          data: { status: "PUBLISHED" },
        });
      }
      const series = await tx.marketPriceSeries.create({
        data: {
          code: `OTE_DAY_AHEAD_15M_${validFrom.toISOString().slice(0, 10)}_${validTo.toISOString().slice(0, 10)}_${fingerprint.slice(0, 8)}`,
          market: "OTE_DAY_AHEAD",
          currency: "CZK",
          timezone: "Europe/Prague",
          resolutionMinutes: 15,
          validFrom,
          validTo,
          sourceUrl: input.sourceUrl,
          sourceSha256: fingerprint,
          status: "PUBLISHED",
        },
      });
      for (let index = 0; index < normalized.length; index += 5_000) {
        await tx.marketPricePoint.createMany({
          data: normalized.slice(index, index + 5_000).map((point) => ({
            seriesId: series.id,
            ...point,
          })),
        });
      }
      return series;
    },
    { maxWait: 10_000, timeout: 120_000 },
  );
}

const responseSchema = z
  .object({
    intervals: z
      .array(
        z
          .object({
            startAt: z.string().datetime(),
            endAt: z.string().datetime(),
            priceCzkKwh: z.number().finite(),
          })
          .strict(),
      )
      .max(40_000),
  })
  .passthrough();

export async function ensureOteMarketCoverage(
  userId: number,
  requiredFrom: Date,
  requiredTo: Date,
) {
  const published = await prisma.marketPriceSeries.findFirst({
    where: {
      market: "OTE_DAY_AHEAD",
      status: "PUBLISHED",
      validFrom: { lte: requiredFrom },
      validTo: { gte: requiredTo },
    },
    orderBy: { validTo: "desc" },
  });
  if (published) return published;

  const [latest, connection] = await Promise.all([
    prisma.marketPriceSeries.findFirst({
      where: { market: "OTE_DAY_AHEAD", status: "PUBLISHED" },
      orderBy: { validTo: "desc" },
    }),
    prisma.energyConnection.findUnique({
      where: {
        userId_provider: { userId, provider: EnergyProvider.LEGACY_SPOTTEX },
      },
    }),
  ]);
  if (!connection?.encryptedAccessToken || !connection.encryptedRefreshToken)
    return null;

  const fetchFrom =
    latest && latest.validFrom < requiredFrom ? latest.validFrom : requiredFrom;
  const requestedFuture = new Date(Date.now() + 2 * 86_400_000);
  const fetchTo = requiredTo > requestedFuture ? requiredTo : requestedFuture;
  if (fetchTo.getTime() - fetchFrom.getTime() > 400 * 86_400_000)
    return null;

  const before = {
    accessToken: decryptSecret(connection.encryptedAccessToken),
    refreshToken: decryptSecret(connection.encryptedRefreshToken),
  };
  const client = new LegacySpottexClient({ tokens: before });
  const parsed = responseSchema.parse(
    await client.fetchMarketIntervals(fetchFrom, fetchTo),
  );
  const rows: OteMarketInterval[] = parsed.intervals
    .map((point) => ({
      startAt: new Date(point.startAt),
      endAt: new Date(point.endAt),
      priceCzkMwh: point.priceCzkKwh * 1_000,
      predicted: false,
    }))
    .filter(
      (point) =>
        point.endAt.getTime() - point.startAt.getTime() === 15 * 60_000,
    )
    .sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
  const after = client.getTokens();
  if (
    after &&
    (after.accessToken !== before.accessToken ||
      after.refreshToken !== before.refreshToken)
  ) {
    await prisma.energyConnection.update({
      where: { id: connection.id },
      data: {
        encryptedAccessToken: encryptSecret(after.accessToken),
        encryptedRefreshToken: encryptSecret(after.refreshToken),
        tokenExpiresAt: accessTokenExpiresAt(after.accessToken),
      },
    });
  }
  return publishOteMarketSeries({
    intervals: rows,
    sourceUrl: legacySourceUrl,
    requiredFrom,
    requiredTo,
  });
}
