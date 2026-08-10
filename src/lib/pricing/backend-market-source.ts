import "server-only";

import { Pool } from "pg";

import { prisma } from "@/lib/prisma";

import {
  publishOteMarketSeries,
  type OteMarketInterval,
} from "./market-sync";

const BACKEND_MARKET_SOURCE =
  "spottex-backend-db://control.ote_prices_15min";

type GlobalWithMarketPool = typeof globalThis & {
  spottexBackendMarketPool?: Pool;
};

function configuredDatabaseUrl() {
  const raw = process.env.SPOTTEX_BACKEND_DATABASE_URL?.trim();
  if (!raw) return null;
  const parsed = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("SPOTTEX_BACKEND_DATABASE_URL_INVALID");
  }
  return raw;
}

function backendPool() {
  const connectionString = configuredDatabaseUrl();
  if (!connectionString) return null;
  const state = globalThis as GlobalWithMarketPool;
  state.spottexBackendMarketPool ??= new Pool({
    connectionString,
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
    query_timeout: 30_000,
    allowExitOnIdle: true,
    application_name: "spottex-market-readonly-sync",
  });
  return state.spottexBackendMarketPool;
}

export type BackendMarketSyncResult = {
  configured: boolean;
  status: "DISABLED" | "SKIPPED" | "SYNCED" | "EMPTY";
  confirmedIntervals: number;
  predictedIntervals: number;
  validFrom: string | null;
  validTo: string | null;
  seriesId: string | null;
};

export async function syncBackendMarketPrices(options?: {
  force?: boolean;
  now?: Date;
}): Promise<BackendMarketSyncResult> {
  const pool = backendPool();
  if (!pool) {
    return {
      configured: false,
      status: "DISABLED",
      confirmedIntervals: 0,
      predictedIntervals: 0,
      validFrom: null,
      validTo: null,
      seriesId: null,
    };
  }
  const now = options?.now ?? new Date();
  const intervalMinutes = Math.max(
    5,
    Number(process.env.MARKET_SYNC_INTERVAL_MINUTES ?? 15),
  );
  const latest = await prisma.marketPriceSeries.findFirst({
    where: {
      market: "OTE_DAY_AHEAD",
      status: "PUBLISHED",
      sourceUrl: BACKEND_MARKET_SOURCE,
    },
    orderBy: { createdAt: "desc" },
  });
  if (
    !options?.force &&
    latest &&
    now.getTime() - latest.updatedAt.getTime() < intervalMinutes * 60_000
  ) {
    return {
      configured: true,
      status: "SKIPPED",
      confirmedIntervals: 0,
      predictedIntervals: 0,
      validFrom: latest.validFrom.toISOString(),
      validTo: latest.validTo.toISOString(),
      seriesId: latest.id,
    };
  }

  const from = new Date(now.getTime() - 400 * 86_400_000);
  const to = new Date(now.getTime() + 7 * 86_400_000);
  const result = await pool.query<{
    startAt: Date;
    endAt: Date;
    priceCzkKwh: number | string;
    predicted: boolean;
  }>(
    `
      SELECT
        time_from AT TIME ZONE 'Europe/Prague' AS "startAt",
        time_to AT TIME ZONE 'Europe/Prague' AS "endAt",
        price_czk_kwh AS "priceCzkKwh",
        prediction AS predicted
      FROM control.ote_prices_15min
      WHERE time_from >= ($1::timestamptz AT TIME ZONE 'Europe/Prague')
        AND time_from < ($2::timestamptz AT TIME ZONE 'Europe/Prague')
      ORDER BY time_from ASC, prediction ASC
    `,
    [from, to],
  );
  const intervals: OteMarketInterval[] = result.rows.map((row) => ({
    startAt: row.startAt,
    endAt: row.endAt,
    priceCzkMwh: Number(row.priceCzkKwh) * 1_000,
    predicted: row.predicted,
  }));
  const confirmedIntervals = intervals.filter((row) => !row.predicted).length;
  const predictedIntervals = intervals.length - confirmedIntervals;
  const series = await publishOteMarketSeries({
    intervals,
    sourceUrl: BACKEND_MARKET_SOURCE,
  });
  if (!series) {
    return {
      configured: true,
      status: "EMPTY",
      confirmedIntervals,
      predictedIntervals,
      validFrom: null,
      validTo: null,
      seriesId: null,
    };
  }
  return {
    configured: true,
    status: "SYNCED",
    confirmedIntervals,
    predictedIntervals,
    validFrom: series.validFrom.toISOString(),
    validTo: series.validTo.toISOString(),
    seriesId: series.id,
  };
}
