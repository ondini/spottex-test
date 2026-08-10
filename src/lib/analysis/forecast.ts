import type { AnalysisDispatchPoint } from "./dispatch";

export type ForecastMethod = "DAY_TYPE_28D" | "SLOT_28D" | "PERSISTENCE_24H" | "PERSISTENCE_168H";
type Signal = "productionKwh" | "consumptionKwh";

export type ForecastMetric = {
  method: ForecastMethod;
  maeKwh: number | null;
  normalizedMaePct: number | null;
  coveragePct: number;
  samples: number;
};

export type ForecastSelection = {
  version: "WALK_FORWARD_34H_V1";
  consumption: { selected: ForecastMethod; metrics: ForecastMetric[] };
  production: { selected: ForecastMethod; metrics: ForecastMetric[] };
  horizonsHours: number[];
  neuralCandidate: "NOT_CONFIGURED";
  note: string;
};

type Observation = { at: number; value: number };

function round(value: number, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

const partsCache = new Map<string, { date: string; weekday: string; slot: number }>();

function parts(at: Date, timezone: string) {
  const cacheKey = `${timezone}:${at.getTime()}`;
  const cached = partsCache.get(cacheKey);
  if (cached) return cached;
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) => values.find((part) => part.type === type)?.value ?? "";
  const result = { date: `${value("year")}-${value("month")}-${value("day")}`, weekday: value("weekday"), slot: Number(value("hour")) * 4 + Math.floor(Number(value("minute")) / 15) };
  partsCache.set(cacheKey, result);
  if (partsCache.size > 200_000) partsCache.clear();
  return result;
}

function easterSunday(year: number) {
  const a = year % 19; const b = Math.floor(year / 100); const c = year % 100;
  const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = (h + l - 7 * m + 114) % 31 + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function isCzechHoliday(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const fixed = new Set(["01-01", "05-01", "05-08", "07-05", "07-06", "09-28", "10-28", "11-17", "12-24", "12-25", "12-26"]);
  if (fixed.has(`${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`)) return true;
  const easter = easterSunday(year);
  const timestamp = Date.UTC(year, month - 1, day);
  return timestamp === easter.getTime() - 2 * 86_400_000 || timestamp === easter.getTime() + 86_400_000;
}

function dayType(at: Date, timezone: string) {
  const local = parts(at, timezone);
  return local.weekday === "Sat" || local.weekday === "Sun" || isCzechHoliday(local.date) ? "FREE" : "WORK";
}

class ForecastState {
  private readonly byTimestamp: Record<Signal, Map<number, number>> = { productionKwh: new Map(), consumptionKwh: new Map() };
  private readonly slots: Record<Signal, Map<string, Observation[]>> = { productionKwh: new Map(), consumptionKwh: new Map() };
  private lastAt = Number.NEGATIVE_INFINITY;
  private readonly lastValue: Record<Signal, number> = { productionKwh: 0, consumptionKwh: 0 };

  constructor(private readonly timezone: string) {}

  observe(point: Pick<AnalysisDispatchPoint, "startAt" | "productionKwh" | "consumptionKwh">) {
    const at = point.startAt.getTime();
    const local = parts(point.startAt, this.timezone);
    for (const signal of ["productionKwh", "consumptionKwh"] as const) {
      const value = point[signal];
      this.byTimestamp[signal].set(at, value);
      for (const key of [`ALL:${local.slot}`, `${dayType(point.startAt, this.timezone)}:${local.slot}`]) {
        const observations = this.slots[signal].get(key) ?? [];
        observations.push({ at, value });
        if (observations.length > 56) observations.shift();
        this.slots[signal].set(key, observations);
      }
      this.lastValue[signal] = value;
    }
    this.lastAt = Math.max(this.lastAt, at);
  }

  predict(signal: Signal, method: ForecastMethod, target: Date): number | null {
    if (!Number.isFinite(this.lastAt)) return null;
    if (method === "PERSISTENCE_24H" || method === "PERSISTENCE_168H") {
      const lag = method === "PERSISTENCE_24H" ? 86_400_000 : 7 * 86_400_000;
      let source = target.getTime() - lag;
      while (source > this.lastAt) source -= lag;
      return this.byTimestamp[signal].get(source) ?? null;
    }
    const local = parts(target, this.timezone);
    const key = method === "DAY_TYPE_28D" ? `${dayType(target, this.timezone)}:${local.slot}` : `ALL:${local.slot}`;
    const observations = (this.slots[signal].get(key) ?? []).filter((item) => item.at <= this.lastAt).slice(-28);
    if (!observations.length) return null;
    return observations.reduce((sum, item) => sum + item.value, 0) / observations.length;
  }

  forecast(signal: Signal, method: ForecastMethod, target: Date) {
    return Math.max(0, this.predict(signal, method, target) ?? this.lastValue[signal]);
  }
}

const CONSUMPTION_METHODS: ForecastMethod[] = ["DAY_TYPE_28D", "SLOT_28D", "PERSISTENCE_168H", "PERSISTENCE_24H"];
const PRODUCTION_METHODS: ForecastMethod[] = ["SLOT_28D", "PERSISTENCE_24H", "PERSISTENCE_168H"];

function evaluateSignal(points: AnalysisDispatchPoint[], timezone: string, signal: Signal, methods: ForecastMethod[], horizons: number[]) {
  const state = new ForecastState(timezone);
  const stats = new Map(methods.map((method) => [method, { absoluteError: 0, actual: 0, samples: 0, opportunities: 0 }]));
  const byTime = new Map(points.map((point) => [point.startAt.getTime(), point]));
  for (let index = 0; index < points.length; index += 1) {
    const origin = points[index];
    if (index % 4 === 0) {
      for (const horizon of horizons) {
        const targetAt = new Date(origin.startAt.getTime() + horizon * 3_600_000);
        const target = byTime.get(targetAt.getTime());
        if (!target) continue;
        for (const method of methods) {
          const stat = stats.get(method)!;
          stat.opportunities += 1;
          const predicted = state.predict(signal, method, targetAt);
          if (predicted == null) continue;
          stat.absoluteError += Math.abs(predicted - target[signal]);
          stat.actual += target[signal];
          stat.samples += 1;
        }
      }
    }
    state.observe(origin);
  }
  return methods.map((method): ForecastMetric => {
    const stat = stats.get(method)!;
    const mae = stat.samples ? stat.absoluteError / stat.samples : null;
    const meanActual = stat.samples ? stat.actual / stat.samples : 0;
    return {
      method,
      maeKwh: mae == null ? null : round(mae, 5),
      normalizedMaePct: mae == null || meanActual <= 0 ? null : round(mae / meanActual * 100, 1),
      coveragePct: stat.opportunities ? round(stat.samples / stat.opportunities * 100, 1) : 0,
      samples: stat.samples,
    };
  });
}

function select(metrics: ForecastMetric[], fallback: ForecastMethod) {
  return [...metrics]
    .filter((metric) => metric.maeKwh != null && metric.coveragePct >= 70 && metric.samples >= 24)
    .sort((left, right) => left.maeKwh! - right.maeKwh! || right.coveragePct - left.coveragePct)[0]?.method ?? fallback;
}

export function selectForecastPolicy(points: AnalysisDispatchPoint[], timezone = "Europe/Prague"): ForecastSelection {
  const horizonsHours = [0.25, 6, 24, 34];
  const consumptionMetrics = evaluateSignal(points, timezone, "consumptionKwh", CONSUMPTION_METHODS, horizonsHours);
  const productionMetrics = evaluateSignal(points, timezone, "productionKwh", PRODUCTION_METHODS, horizonsHours);
  return {
    version: "WALK_FORWARD_34H_V1",
    consumption: { selected: select(consumptionMetrics, "DAY_TYPE_28D"), metrics: consumptionMetrics },
    production: { selected: select(productionMetrics, "SLOT_28D"), metrics: productionMetrics },
    horizonsHours,
    neuralCandidate: "NOT_CONFIGURED",
    note: "Prediktor je vybrán walk-forward validací; jednoduchý profil zůstává výchozí, dokud neuronový kandidát neprokáže nižší chybu na datech dané elektrárny.",
  };
}

export function createForecastRuntime(selection: ForecastSelection, timezone = "Europe/Prague") {
  const state = new ForecastState(timezone);
  return {
    observe: (point: AnalysisDispatchPoint) => state.observe(point),
    forecast: (point: AnalysisDispatchPoint): AnalysisDispatchPoint => ({
      ...point,
      productionKwh: state.forecast("productionKwh", selection.production.selected, point.startAt),
      consumptionKwh: state.forecast("consumptionKwh", selection.consumption.selected, point.startAt),
    }),
  };
}
