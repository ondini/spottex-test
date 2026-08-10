import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { prisma } from "../src/lib/prisma";

const sourceUrl =
  "https://www.ote-cr.cz/cs/kratkodobe-trhy/elektrina/denni-trh?time_resolution=PT15M";

async function main() {
  const raw = await readFile("/dev/stdin", "utf8");
  const rows = raw
    .trim()
    .split("\n")
    .flatMap((line) => {
      const [startRaw, endRaw, priceRaw] = line.split("|");
      const startAt = new Date(startRaw);
      const endAt = new Date(endRaw);
      const priceCzkKwh = Number(priceRaw);
      return Number.isFinite(startAt.getTime()) &&
        Number.isFinite(endAt.getTime()) &&
        Number.isFinite(priceCzkKwh)
        ? [{ startAt, endAt, priceCzkMwh: priceCzkKwh * 1_000 }]
        : [];
    })
    .sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
  if (rows.length < 96) throw new Error("OTE_MARKET_IMPORT_INSUFFICIENT");

  const byStart = new Map(
    rows.map((row) => [row.startAt.getTime(), row] as const),
  );
  const validFrom = rows[0].startAt;
  const validTo = rows[rows.length - 1].endAt;
  const normalized: Array<{
    startAt: Date;
    endAt: Date;
    priceCzkMwh: number;
  }> = [];
  let previousPrice = rows[0].priceCzkMwh;
  for (
    let timestamp = validFrom.getTime();
    timestamp < validTo.getTime();
    timestamp += 15 * 60_000
  ) {
    const existing = byStart.get(timestamp);
    if (existing) previousPrice = existing.priceCzkMwh;
    normalized.push({
      startAt: new Date(timestamp),
      endAt: new Date(timestamp + 15 * 60_000),
      priceCzkMwh: existing?.priceCzkMwh ?? previousPrice,
    });
  }
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        sourceUrl,
        validFrom: validFrom.toISOString(),
        validTo: validTo.toISOString(),
        normalized,
      }),
    )
    .digest("hex");
  const existing = await prisma.marketPriceSeries.findFirst({
    where: { sourceSha256: fingerprint },
  });
  if (existing) {
    console.log(JSON.stringify({ id: existing.id, reused: true }));
    return;
  }

  const series = await prisma.$transaction(
    async (tx) => {
      await tx.marketPriceSeries.updateMany({
        where: { market: "OTE_DAY_AHEAD", status: "PUBLISHED" },
        data: { status: "ARCHIVED" },
      });
      const created = await tx.marketPriceSeries.create({
        data: {
          code: `OTE_DAY_AHEAD_15M_${validFrom.toISOString().slice(0, 10)}_${validTo.toISOString().slice(0, 10)}`,
          market: "OTE_DAY_AHEAD",
          currency: "CZK",
          timezone: "Europe/Prague",
          resolutionMinutes: 15,
          validFrom,
          validTo,
          sourceUrl,
          sourceSha256: fingerprint,
          status: "PUBLISHED",
        },
      });
      for (let index = 0; index < normalized.length; index += 5_000) {
        await tx.marketPricePoint.createMany({
          data: normalized
            .slice(index, index + 5_000)
            .map((point) => ({ seriesId: created.id, ...point })),
        });
      }
      return created;
    },
    { timeout: 120_000 },
  );
  console.log(
    JSON.stringify({ id: series.id, points: normalized.length, reused: false }),
  );
}

main()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
