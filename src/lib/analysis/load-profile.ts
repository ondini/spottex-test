import { EnergyIntervalKind } from "@prisma/client";

export type LoadInterval = {
  kind: EnergyIntervalKind;
  startAt: Date;
  endAt: Date;
  kwh: number;
};

export type IndependentLoadPoint = {
  startAt: Date;
  endAt: Date;
  productionKwh: number;
  consumptionKwh: number;
};

export type LoadProfileProvenance = {
  method: "DIRECT_SITE_LOAD" | "POWER_BALANCE_RECONSTRUCTED" | "HYBRID";
  contractVersion: "SPOTTEX_INTERVAL_BALANCE_V1";
  directIntervals: number;
  reconstructedIntervals: number;
  comparedIntervals: number;
  mismatchedIntervals: number;
  meanAbsoluteDifferenceKwh: number | null;
};

export function aggregateSiteIntervals(
  intervals: LoadInterval[],
): LoadInterval[] {
  const aggregated = new Map<string, LoadInterval>();
  for (const interval of intervals) {
    const key = `${interval.startAt.getTime()}:${interval.kind}`;
    const current = aggregated.get(key);
    if (current) {
      current.kwh += interval.kwh;
      if (interval.endAt > current.endAt) current.endAt = interval.endAt;
    } else {
      aggregated.set(key, { ...interval });
    }
  }
  return [...aggregated.values()].sort(
    (left, right) =>
      left.startAt.getTime() - right.startAt.getTime() ||
      left.kind.localeCompare(right.kind),
  );
}

type Bucket = {
  endAt: Date;
  production?: number;
  consumption?: number;
  battery?: number;
  gridImport?: number;
  gridExport?: number;
};

/**
 * Produces the physical site load, never the grid import. The canonical battery
 * sign is positive for discharge and negative for charging, therefore:
 * load = production + grid import + battery - grid export.
 */
export function deriveIndependentLoadProfile(intervals: LoadInterval[]): {
  points: IndependentLoadPoint[];
  provenance: LoadProfileProvenance;
} {
  const buckets = new Map<number, Bucket>();
  for (const interval of intervals) {
    const timestamp = interval.startAt.getTime();
    const bucket = buckets.get(timestamp) ?? { endAt: interval.endAt };
    if (interval.kind === EnergyIntervalKind.PRODUCTION) bucket.production = interval.kwh;
    if (interval.kind === EnergyIntervalKind.CONSUMPTION) bucket.consumption = interval.kwh;
    if (interval.kind === EnergyIntervalKind.BATTERY) bucket.battery = interval.kwh;
    if (interval.kind === EnergyIntervalKind.GRID_IMPORT) bucket.gridImport = interval.kwh;
    if (interval.kind === EnergyIntervalKind.GRID_EXPORT) bucket.gridExport = interval.kwh;
    buckets.set(timestamp, bucket);
  }

  let directIntervals = 0;
  let reconstructedIntervals = 0;
  let comparedIntervals = 0;
  let mismatchedIntervals = 0;
  let absoluteDifference = 0;
  const points: IndependentLoadPoint[] = [];
  for (const [timestamp, bucket] of [...buckets.entries()].sort(([left], [right]) => left - right)) {
    if (bucket.production == null) continue;
    const canReconstruct = bucket.gridImport != null && bucket.gridExport != null && bucket.battery != null;
    const reconstructed = canReconstruct
      ? Math.max(0, bucket.production + bucket.gridImport! + bucket.battery! - bucket.gridExport!)
      : null;
    let directMatchesBalance = reconstructed == null;
    if (bucket.consumption != null && reconstructed != null) {
      const difference = Math.abs(bucket.consumption - reconstructed);
      const tolerance = Math.max(0.05, Math.max(bucket.consumption, reconstructed, 0) * 0.05);
      comparedIntervals += 1;
      absoluteDifference += difference;
      directMatchesBalance = difference <= tolerance;
      if (!directMatchesBalance) mismatchedIntervals += 1;
    }
    // Prefer a direct site-load channel only while it satisfies the physical
    // balance. On SolaX multi-inverter plants a meter-less inverter reports its
    // own AC output as "consumption", which must not override complete grid and
    // battery flows from the whole site.
    const useDirect = bucket.consumption != null && directMatchesBalance;
    const consumption = useDirect ? bucket.consumption : reconstructed ?? bucket.consumption;
    if (consumption == null || !Number.isFinite(consumption) || consumption < -1e-6) continue;
    if (useDirect) directIntervals += 1;
    else reconstructedIntervals += 1;
    points.push({
      startAt: new Date(timestamp),
      endAt: bucket.endAt,
      productionKwh: bucket.production,
      consumptionKwh: Math.max(0, consumption),
    });
  }
  return {
    points,
    provenance: {
      method: reconstructedIntervals === 0 ? "DIRECT_SITE_LOAD" : directIntervals === 0 ? "POWER_BALANCE_RECONSTRUCTED" : "HYBRID",
      contractVersion: "SPOTTEX_INTERVAL_BALANCE_V1",
      directIntervals,
      reconstructedIntervals,
      comparedIntervals,
      mismatchedIntervals,
      meanAbsoluteDifferenceKwh: comparedIntervals ? Math.round(absoluteDifference / comparedIntervals * 1_000_000) / 1_000_000 : null,
    },
  };
}
