import "server-only";

import { Pool } from "pg";

// One read-only connection pool to the energy backend's PostgreSQL. The role
// behind SPOTTEX_BACKEND_DATABASE_URL may only read; market prices and the
// live control activity are copied or shown from here, nothing is written.

type GlobalWithBackendPool = typeof globalThis & {
  spottexBackendReadonlyPool?: Pool;
};

export function backendDatabaseUrl() {
  const raw = process.env.SPOTTEX_BACKEND_DATABASE_URL?.trim();
  if (!raw) return null;
  const parsed = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("SPOTTEX_BACKEND_DATABASE_URL_INVALID");
  }
  return raw;
}

export function backendReadonlyPool() {
  const connectionString = backendDatabaseUrl();
  if (!connectionString) return null;
  const state = globalThis as GlobalWithBackendPool;
  state.spottexBackendReadonlyPool ??= new Pool({
    connectionString,
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
    query_timeout: 30_000,
    allowExitOnIdle: true,
    application_name: "spottex-platform-readonly",
  });
  return state.spottexBackendReadonlyPool;
}

export type BackendControlActivity = {
  deviceId: string;
  lastRun: { finishedAt: string; status: string; costCzk: number | null; planUntil: string | null } | null;
  lastCommand: { command: string; at: string } | null;
  scheduleUpdatedAt: string | null;
  optimizationRunning: boolean | null;
};

/**
 * What the backend's optimizer and control broadcaster last did for the
 * given backend device ids: the newest optimization run, the newest command
 * handed to the inverter and when the schedule was last rewritten. Read-only.
 */
export async function backendControlActivity(deviceIds: string[]): Promise<BackendControlActivity[] | null> {
  const pool = backendReadonlyPool();
  const ids = deviceIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0);
  if (!pool || !ids.length) return null;
  const [runs, commands, schedules, inverters] = await Promise.all([
    pool.query<{ device_id: number | string; finished_at: Date | null; started_at: Date; status: string; cost_czk: string | null; interval_to: Date | null }>(
      `SELECT DISTINCT ON (device_id) device_id, started_at, finished_at, status, cost_czk, interval_to
         FROM control.optimization_runs WHERE device_id = ANY($1::int[])
         ORDER BY device_id, started_at DESC`,
      [ids],
    ),
    pool.query<{ device_id: number | string; command: string; created_at: Date }>(
      `SELECT DISTINCT ON (device_id) device_id, command, created_at
         FROM control.control_commands WHERE device_id = ANY($1::int[])
         ORDER BY device_id, created_at DESC`,
      [ids],
    ),
    pool.query<{ device_id: number | string; updated_at: Date | null }>(
      `SELECT device_id, MAX(created_at) AS updated_at FROM control.device_schedule
         WHERE device_id = ANY($1::int[]) GROUP BY device_id`,
      [ids],
    ),
    pool.query<{ device_id: number | string; optimization_running: boolean | null }>(
      `SELECT device_id, optimization_running FROM general.inverters WHERE device_id = ANY($1::int[])`,
      [ids],
    ),
  ]);
  // interval_to of a run is a naive Europe/Prague wall-clock time; pg parsed it
  // in this process's zone (UTC in the container), so re-read its fields as
  // Prague time to get the real instant.
  const localToIso = (value: Date | null) => (value ? pragueWallClockToInstant(value).toISOString() : null);
  // device_id is a bigint in the backend, which pg hands over as a string.
  const same = (row: { device_id: number | string }, id: number) => Number(row.device_id) === id;
  return ids.map((id) => {
    const run = runs.rows.find((row) => same(row, id)) ?? null;
    const command = commands.rows.find((row) => same(row, id)) ?? null;
    const schedule = schedules.rows.find((row) => same(row, id)) ?? null;
    const inverter = inverters.rows.find((row) => same(row, id)) ?? null;
    return {
      deviceId: String(id),
      lastRun: run
        ? {
            finishedAt: (run.finished_at ?? run.started_at).toISOString(),
            status: run.status,
            costCzk: run.cost_czk == null ? null : Number(run.cost_czk),
            planUntil: localToIso(run.interval_to),
          }
        : null,
      lastCommand: command ? { command: command.command, at: command.created_at.toISOString() } : null,
      scheduleUpdatedAt: schedule?.updated_at?.toISOString() ?? null,
      optimizationRunning: inverter?.optimization_running ?? null,
    };
  });
}

export type BackendControlSavings = {
  deviceId: string;
  dayCzk: number;
  weekCzk: number;
  monthCzk: number;
  yearCzk: number;
  intervals: Array<{ from: string; to: string; savingsCzk: number; productionKwh: number; consumptionKwh: number; otePriceCzkKwh: number | null }>;
};

/**
 * What the control actually earned, as the backend measures it: the running
 * day/week/month/year totals and the last hours interval by interval. Each
 * interval compares the real grid flow with a simulated uncontrolled one.
 */
export async function backendControlSavings(deviceIds: string[], hours = 24): Promise<BackendControlSavings[] | null> {
  const pool = backendReadonlyPool();
  const ids = deviceIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0);
  if (!pool || !ids.length) return null;
  const since = new Date(Date.now() - hours * 3_600_000);
  const [summary, intervals] = await Promise.all([
    pool.query<{ device_id: number | string; savings_day_czk: string | null; savings_week_czk: string | null; savings_month_czk: string | null; savings_year_czk: string | null }>(
      `SELECT device_id, savings_day_czk, savings_week_czk, savings_month_czk, savings_year_czk
         FROM control.device_savings_summary WHERE device_id = ANY($1::int[])`,
      [ids],
    ),
    pool.query<{ device_id: number | string; time_from: Date; time_to: Date; savings_czk: string | null; production_kwh: string | null; consumption_kwh: string | null; ote_price_czk_kwh: string | null }>(
      `SELECT device_id, time_from, time_to, savings_czk, production_kwh, consumption_kwh, ote_price_czk_kwh
         FROM control.device_savings WHERE device_id = ANY($1::int[]) AND time_from >= $2
         ORDER BY time_from`,
      [ids, since],
    ),
  ]);
  const number = (value: string | null) => (value == null ? 0 : Number(value));
  return ids.map((id) => {
    const row = summary.rows.find((item) => Number(item.device_id) === id) ?? null;
    return {
      deviceId: String(id),
      dayCzk: number(row?.savings_day_czk ?? null),
      weekCzk: number(row?.savings_week_czk ?? null),
      monthCzk: number(row?.savings_month_czk ?? null),
      yearCzk: number(row?.savings_year_czk ?? null),
      intervals: intervals.rows
        .filter((item) => Number(item.device_id) === id)
        .map((item) => ({
          from: pragueWallClockToInstant(item.time_from).toISOString(),
          to: pragueWallClockToInstant(item.time_to).toISOString(),
          savingsCzk: number(item.savings_czk),
          productionKwh: number(item.production_kwh),
          consumptionKwh: number(item.consumption_kwh),
          otePriceCzkKwh: item.ote_price_czk_kwh == null ? null : Number(item.ote_price_czk_kwh),
        })),
    };
  });
}

const PRAGUE = "Europe/Prague";

function pragueOffsetMs(at: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: PRAGUE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second")) - at.getTime();
}

/** A Date whose UTC fields hold a Prague wall-clock time, turned into the instant. */
export function pragueWallClockToInstant(wall: Date) {
  const guess = new Date(wall.getTime() - pragueOffsetMs(wall));
  return new Date(wall.getTime() - pragueOffsetMs(guess));
}
