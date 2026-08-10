import type {
  EnergyCurrentValues,
  EnergyDashboardSnapshot,
  EnergyScheduleItem,
  EnergySeriesPoint,
  EnergySiteSummary,
  LegacyDashboardPayload,
  LegacyPlant,
} from "./types";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function finiteNumber(value: unknown): number | null {
  if (typeof value === "string" && value.trim() === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function mapLegacyPlant(value: unknown, index = 0): LegacyPlant | null {
  const plant = object(value);
  const rawSiteId = plant.id;
  const rawDeviceId = plant.device_id;
  if ((typeof rawSiteId !== "string" && typeof rawSiteId !== "number") ||
      (typeof rawDeviceId !== "string" && typeof rawDeviceId !== "number")) {
    return null;
  }

  return {
    siteId: String(rawSiteId),
    deviceId: String(rawDeviceId),
    name: text(plant.name, `Elektrárna ${index + 1}`),
    optimizationOn: booleanValue(plant.optimization_running),
    // Legacy `required_info` is a completeness flag: true means the inverter
    // already has every technical input needed for optimization. The new model
    // stores the inverse condition (`requiredInfo` means more info is needed).
    requiredInfo: !booleanValue(plant.required_info),
    location: text(plant.location) || null,
    pvCapacityKwp: finiteNumber(
      plant.pv_capacity_kwp ?? plant.pvCapacityKwp ?? plant.peak,
    ),
    batteryCapacityKwh: finiteNumber(
      plant.battery_capacity_kwh ??
        plant.batteryCapacityKwh ??
        plant.battery_capacity,
    ),
    inverterModel:
      text(plant.inverter_model ?? plant.model) || null,
    inverterRatedPowerKw: finiteNumber(
      plant.rated_power_kw ?? plant.inverter_rated_power_kw,
    ),
    inverterSerialSuffix:
      text(plant.serial_suffix ?? plant.inverter_serial_suffix) || null,
    deviceCoverageStatus:
      plant.device_coverage_status === "COMPLETE" ||
      plant.device_coverage_status === "POSSIBLY_INCOMPLETE"
        ? plant.device_coverage_status
        : "UNKNOWN",
    availableInverterRatedPowerKw: finiteNumber(
      plant.available_inverter_rated_power_kw,
    ),
    deviceCoveragePercent: finiteNumber(plant.device_coverage_percent),
  };
}

function dateString(value: unknown, fallback: Date): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "number" || typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return fallback.toISOString();
}

function optionalDateString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "number" && typeof value !== "string" && !(value instanceof Date)) continue;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

type SeriesKey = "productionKwh" | "consumptionKwh" | "batteryKwh";

function intervalEnd(item: JsonObject, at: string): string {
  const fallback = new Date(new Date(at).getTime() + 15 * 60 * 1000);
  return dateString(item.time_to, fallback);
}

function isPredicted(item: JsonObject, at: string, now: Date): boolean {
  if ("prediction" in item) return booleanValue(item.prediction);
  if ("predicted" in item) return booleanValue(item.predicted);
  const currentBucketStart = Math.floor(now.getTime() / 900_000) * 900_000;
  return new Date(at).getTime() >= currentBucketStart;
}

function emptySeriesPoint(item: JsonObject, at: string, now: Date): EnergySeriesPoint {
  return {
    at,
    endAt: intervalEnd(item, at),
    predicted: isPredicted(item, at, now),
    productionKwh: 0,
    consumptionKwh: 0,
    batteryKwh: 0,
    gridImportKwh: 0,
    gridExportKwh: 0,
  };
}

function mergeIntervalSeries(
  target: Map<string, EnergySeriesPoint>,
  rawItems: unknown,
  key: SeriesKey,
  now: Date,
  normalize: (value: number) => number = (value) => value,
): void {
  for (const raw of array(rawItems)) {
    const item = object(raw);
    const at = dateString(item.time_from, now);
    const current = target.get(at) ?? emptySeriesPoint(item, at, now);
    const normalized = normalize(finiteNumber(item.kwh) ?? 0);
    current[key] =
      key === "batteryKwh" ? normalized : Math.max(0, normalized);
    target.set(at, current);
  }
}

function canonicalBatteryFlow(value: unknown): number | null {
  const legacyValue = finiteNumber(value);
  if (legacyValue == null) return null;
  // SolaX/legacy stores charge as positive. Spottex's canonical energy
  // interval contract uses discharge as positive, so normalize at the
  // integration boundary before the value can be persisted or analysed.
  return legacyValue === 0 ? 0 : -legacyValue;
}

function timezoneParts(value: Date, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/**
 * A hard physical guard for PV forecasts. The legacy neural predictor may
 * occasionally return a phase-shifted curve. Weather and model uncertainty can
 * change the height of a PV curve, but never create production while the sun
 * is below the horizon.
 */
export function isApproximateDaylight(
  value: Date,
  timezone = "Europe/Prague",
  latitudeDeg = 50,
) {
  const local = timezoneParts(value, timezone);
  const dayOfYear = Math.floor(
    (Date.UTC(local.year, local.month - 1, local.day) -
      Date.UTC(local.year, 0, 0)) /
      86_400_000,
  );
  const declination =
    23.44 * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365);
  const latitude = (latitudeDeg * Math.PI) / 180;
  const declinationRad = (declination * Math.PI) / 180;
  const hourAngle = Math.acos(
    Math.max(
      -1,
      Math.min(-Math.tan(latitude) * Math.tan(declinationRad), 1),
    ),
  );
  const dayLengthHours = (2 * hourAngle * 180) / Math.PI / 15;
  const localHour = local.hour + local.minute / 60;
  const solarNoon = 12.5;
  return (
    localHour >= solarNoon - dayLengthHours / 2 &&
    localHour <= solarNoon + dayLengthHours / 2
  );
}

export function mapLegacyDailySeries(
  value: unknown,
  now: Date,
  timezone = "Europe/Prague",
): EnergySeriesPoint[] {
  const energy = object(value);
  const points = new Map<string, EnergySeriesPoint>();
  mergeIntervalSeries(points, energy.production, "productionKwh", now);
  mergeIntervalSeries(points, energy.consumption, "consumptionKwh", now);
  mergeIntervalSeries(points, energy.battery, "batteryKwh", now, (value) => value === 0 ? 0 : -value);

  for (const raw of array(energy.battery)) {
    const item = object(raw);
    const at = dateString(item.time_from, now);
    const current = points.get(at) ?? emptySeriesPoint(item, at, now);
    const batterySocKwh = finiteNumber(item.soc_kwh);
    const batteryCapacityKwh = finiteNumber(item.battery_capacity_kwh);
    if (batterySocKwh != null || batteryCapacityKwh != null) {
      current.batterySocKwh = batterySocKwh;
      current.batteryCapacityKwh = batteryCapacityKwh;
      current.batterySocPct =
        batterySocKwh != null && batteryCapacityKwh != null && batteryCapacityKwh > 0
          ? Math.min(100, Math.max(0, batterySocKwh / batteryCapacityKwh * 100))
          : null;
    }
    points.set(at, current);
  }

  for (const raw of array(energy.grid)) {
    const item = object(raw);
    const at = dateString(item.time_from, now);
    const current = points.get(at) ?? emptySeriesPoint(item, at, now);
    current.gridImportKwh = Math.max(0, finiteNumber(item.import_kwh) ?? 0);
    current.gridExportKwh = Math.max(0, finiteNumber(item.export_kwh) ?? 0);
    points.set(at, current);
  }

  return [...points.values()]
    .map((point) => ({
      ...point,
      productionKwh:
        point.predicted &&
        !isApproximateDaylight(new Date(point.at), timezone)
          ? 0
          : Math.max(0, point.productionKwh),
      consumptionKwh: Math.max(0, point.consumptionKwh),
    }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function mapLegacySchedule(value: unknown, now: Date): EnergyScheduleItem[] {
  return array(value)
    .map((raw, index) => {
      const item = object(raw);
      const fallbackStart = new Date(now.getTime() + index * 60 * 60 * 1000);
      const startAt = dateString(item.startTime, fallbackStart);
      const endAt = dateString(item.endTime, new Date(fallbackStart.getTime() + 60 * 60 * 1000));
      return {
        startAt,
        endAt,
        mode: text(item.mode, "AUTO"),
        sellKw: finiteNumber(item.P_sell),
        buyKw: finiteNumber(item.P_buy),
        batteryKw: finiteNumber(item.P_bat),
        targetSocPct: finiteNumber(item.SOC),
        costCzk: finiteNumber(item.cost),
      };
    })
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}

export function mapLegacyDashboard(input: {
  payload: LegacyDashboardPayload;
  now: Date;
  sites: EnergySiteSummary[];
  selectedSiteId: number;
  timezone?: string;
}): EnergyDashboardSnapshot {
  const inverter = object(input.payload.inverter);
  const soc = object(input.payload.soc);
  const capacity = object(input.payload.capacity);
  const price = object(input.payload.price);
  const savings = object(input.payload.savings);
  const issues = [...input.payload.issues];
  const sourceMeasuredAt = optionalDateString(inverter.measurement_time, inverter.measured_at, inverter.timestamp);
  if (!["savings_day_czk", "savings_week_czk", "savings_month_czk", "savings_year_czk"].some((key) => key in savings)
      && !issues.some((issue) => issue.section === "savings")) {
    issues.push({ section: "savings", message: "Ověřený výpočet úspor zatím není dostupný." });
  }

  const current: EnergyCurrentValues = {
    // The legacy cache column names end in `_kwh`, but its writer explicitly
    // stores W/1000 instantaneous samples. Prefer canonical future `*_kw` keys.
    productionKw: finiteNumber(inverter.production_kw ?? inverter.production_kwh ?? inverter.yieldtoday),
    consumptionKw: finiteNumber(inverter.consumption_kw ?? inverter.consumption_kwh),
    // The verified legacy writer stores SolaX feed-in power: positive export,
    // negative import. Spottex normalizes that to positive import/negative export.
    gridKw: (() => {
      const canonical = finiteNumber(inverter.grid_kw);
      if (canonical != null) return canonical;
      const legacyFeedIn = finiteNumber(inverter.export_to_grid_kw ?? inverter.export_to_grid_kwh);
      return legacyFeedIn == null ? null : -legacyFeedIn;
    })(),
    batteryKw: canonicalBatteryFlow(inverter.battery_kw ?? inverter.battery_flow_kwh),
    batterySocPct: finiteNumber(soc.soc ?? inverter.battery_soc),
    // The legacy `/capacity` endpoint returns installed PV peak power. Battery
    // capacity is not part of this dashboard contract and must not be guessed.
    batteryCapacityKwh: null,
    pvCapacityKwp: finiteNumber(capacity.capacity),
    buyPriceCzk: finiteNumber(price.buy),
    sellPriceCzk: finiteNumber(price.sell),
  };

  return {
    generatedAt: input.now.toISOString(),
    dataAsOf: sourceMeasuredAt ?? input.now.toISOString(),
    dataTimestampKind: sourceMeasuredAt ? "MEASURED" : "RECEIVED",
    source: "LIVE",
    stale: false,
    warning: issues.length
      ? "Část živých dat není dostupná. Dostupné hodnoty zůstávají zobrazené."
      : null,
    issues,
    sites: input.sites.map((site) =>
      site.id === input.selectedSiteId
        ? { ...site, optimizationOn: booleanValue(inverter.optimization_running) }
        : site,
    ),
    selectedSiteId: input.selectedSiteId,
    inverterCount: 1,
    current,
    dailySeries: mapLegacyDailySeries(
      input.payload.dailyEnergy,
      input.now,
      input.timezone,
    ),
    savings: {
      todayCzk: finiteNumber(savings.savings_day_czk) ?? 0,
      weekCzk: finiteNumber(savings.savings_week_czk) ?? 0,
      monthCzk: finiteNumber(savings.savings_month_czk) ?? 0,
      yearCzk: finiteNumber(savings.savings_year_czk) ?? 0,
    },
    schedule: mapLegacySchedule(input.payload.schedule, input.now),
    history: {
      importStatus: "NOT_STARTED",
      progressPercent: 0,
      importedPoints: 0,
      totalChunks: 0,
      succeededChunks: 0,
      failedChunks: 0,
      dataFrom: null,
      dataTo: null,
      coverageDays: 0,
      spanDays: 0,
      coveragePercent: 0,
      confidence: "NONE",
      readyForEstimate: false,
      minimumDays: 7,
      message: "Zjišťujeme rozsah naměřené historie.",
    },
  };
}
