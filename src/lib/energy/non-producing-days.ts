// Days the plant did not produce although its inverters kept sampling.
//
// MŠ Větrník stood still from March to May 2026 (27, 5 and 3 kWh a month from
// 20 kWp) while both inverters reported every quarter hour. Such days say
// nothing about what a tariff would cost with a working plant, so the owner
// decided (8. 9. 2026) they are left out of the analysis and of the coverage
// figures altogether. A day counts as non-producing when it has enough samples
// to be a measured day and its production stays at or below 0.01 kWh per kWp
// of installed capacity (exactly zero when the capacity is unknown), which is
// sensor noise, not a gloomy winter day.

export const NON_PRODUCING_KWH_PER_KWP = 0.01;
export const NON_PRODUCING_MIN_SAMPLES = 48;

type IntervalLike = { kind: string; startAt: Date; kwh: number | { toString(): string } };

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** Local calendar day ("2026-04-12") of an instant in the given zone. */
export function localDayKey(at: Date, timeZone = "Europe/Prague") {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormatters.set(timeZone, formatter);
  }
  return formatter.format(at);
}

export function nonProducingDayKeys(
  intervals: IntervalLike[],
  options: { pvCapacityKwp: number | null | undefined; timeZone?: string; minSamples?: number },
) {
  const threshold = options.pvCapacityKwp && options.pvCapacityKwp > 0 ? NON_PRODUCING_KWH_PER_KWP * options.pvCapacityKwp : 0;
  const minSamples = options.minSamples ?? NON_PRODUCING_MIN_SAMPLES;
  const byDay = new Map<string, { kwh: number; samples: number }>();
  for (const interval of intervals) {
    if (interval.kind !== "PRODUCTION") continue;
    const key = localDayKey(interval.startAt, options.timeZone);
    const entry = byDay.get(key) ?? { kwh: 0, samples: 0 };
    entry.kwh += Number(interval.kwh);
    entry.samples += 1;
    byDay.set(key, entry);
  }
  const days = new Set<string>();
  for (const [key, entry] of byDay) {
    if (entry.samples >= minSamples && entry.kwh <= threshold) days.add(key);
  }
  return days;
}

export function withoutNonProducingDays<T extends { startAt: Date }>(intervals: T[], days: Set<string>, timeZone?: string) {
  if (!days.size) return intervals;
  return intervals.filter((interval) => !days.has(localDayKey(interval.startAt, timeZone)));
}
