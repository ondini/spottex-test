import type {
  EnergyCurrentValues,
  EnergyDashboardSnapshot,
  EnergySeriesPoint,
} from "./types";

function sumNullable(
  values: Array<number | null>,
  clampAtZero = false,
): number | null {
  const present = values.filter((value): value is number => value != null);
  if (!present.length) return null;
  const sum = present.reduce((total, value) => total + value, 0);
  return clampAtZero ? Math.max(0, sum) : sum;
}

function aggregateCurrent(
  snapshots: EnergyDashboardSnapshot[],
): EnergyCurrentValues {
  const primary = snapshots[0].current;
  const productionKw = sumNullable(
    snapshots.map((snapshot) => snapshot.current.productionKw),
    true,
  );
  const gridKw = sumNullable(
    snapshots.map((snapshot) => snapshot.current.gridKw),
  );
  const batteryKw = sumNullable(
    snapshots.map((snapshot) => snapshot.current.batteryKw),
  );
  const canDeriveSiteConsumption = snapshots.every(
    (snapshot) =>
      !snapshot.issues.some((issue) => issue.section === "telemetry") &&
      snapshot.current.productionKw != null &&
      snapshot.current.gridKw != null &&
      snapshot.current.batteryKw != null,
  );
  return {
    productionKw,
    // SolaX reports the grid meter only on one inverter of a multi-inverter
    // plant. Adding the vendor's per-inverter "consumption" therefore counts
    // the AC output of meter-less inverters as building load. At site level the
    // physically valid load is PV + signed grid + signed battery flow.
    consumptionKw:
      canDeriveSiteConsumption && productionKw != null && gridKw != null && batteryKw != null
        ? Math.max(0, productionKw + gridKw + batteryKw)
        : sumNullable(
            snapshots.map((snapshot) => snapshot.current.consumptionKw),
            true,
          ),
    gridKw,
    batteryKw,
    batterySocPct:
      snapshots
        .map((snapshot) => snapshot.current.batterySocPct)
        .find((value) => value != null) ?? null,
    batteryCapacityKwh: primary.batteryCapacityKwh,
    pvCapacityKwp: primary.pvCapacityKwp,
    buyPriceCzk: primary.buyPriceCzk,
    sellPriceCzk: primary.sellPriceCzk,
  };
}

function aggregateSeries(
  snapshots: EnergyDashboardSnapshot[],
  deriveSiteConsumption: boolean,
): EnergySeriesPoint[] {
  const points = new Map<string, EnergySeriesPoint>();
  for (const snapshot of snapshots) {
    for (const candidate of snapshot.dailySeries) {
      const point = points.get(candidate.at) ?? {
        at: candidate.at,
        endAt: candidate.endAt,
        predicted: candidate.predicted,
        productionKwh: 0,
        consumptionKwh: 0,
        batteryKwh: 0,
        gridImportKwh: 0,
        gridExportKwh: 0,
      };
      point.predicted = point.predicted || candidate.predicted;
      point.productionKwh += candidate.productionKwh;
      point.consumptionKwh += candidate.consumptionKwh;
      point.batteryKwh += candidate.batteryKwh;
      if (candidate.batterySocKwh != null) {
        point.batterySocKwh = (point.batterySocKwh ?? 0) + candidate.batterySocKwh;
      }
      if (candidate.batteryCapacityKwh != null) {
        point.batteryCapacityKwh =
          (point.batteryCapacityKwh ?? 0) + candidate.batteryCapacityKwh;
      }
      point.gridImportKwh += candidate.gridImportKwh;
      point.gridExportKwh += candidate.gridExportKwh;
      points.set(candidate.at, point);
    }
  }
  return [...points.values()]
    .map((point) => ({
      ...point,
      productionKwh: Math.max(0, point.productionKwh),
      // Future grid and battery flows only exist after an optimization plan is
      // built. Treating their absent values as zero makes forecast consumption
      // collapse to PV production. For forecasts use the consumption model;
      // reconstruct the physical load only for measured intervals.
      consumptionKwh: deriveSiteConsumption && !point.predicted
        ? Math.max(
            0,
            point.productionKwh +
              point.gridImportKwh -
              point.gridExportKwh +
              point.batteryKwh,
          )
        : Math.max(0, point.consumptionKwh),
      batterySocPct:
        point.batterySocKwh != null &&
        point.batteryCapacityKwh != null &&
        point.batteryCapacityKwh > 0
          ? Math.min(100, Math.max(0, point.batterySocKwh / point.batteryCapacityKwh * 100))
          : null,
    }))
    .sort((left, right) => left.at.localeCompare(right.at));
}

export function aggregateDashboardSnapshots(
  snapshots: EnergyDashboardSnapshot[],
): EnergyDashboardSnapshot {
  const primary = snapshots[0];
  if (!primary) throw new Error("ENERGY_DASHBOARD_EMPTY");
  if (snapshots.length === 1) return primary;
  const deriveSiteConsumption = snapshots.every(
    (snapshot) =>
      snapshot.dailySeries.length > 0 &&
      !snapshot.issues.some((issue) => issue.section === "history"),
  );
  const issues = [
    ...new Map(
      snapshots
        .flatMap((snapshot) => snapshot.issues)
        .map((issue) => [`${issue.section}:${issue.message}`, issue]),
    ).values(),
  ];
  return {
    ...primary,
    inverterCount: snapshots.length,
    current: aggregateCurrent(snapshots),
    dailySeries: aggregateSeries(snapshots, deriveSiteConsumption),
    issues,
    warning: issues.length
      ? "Některá doplňková data nejsou dostupná. Zobrazené energetické hodnoty zahrnují dostupné střídače."
      : null,
  };
}
