import { EnergyIntervalKind } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  aggregateSiteIntervals,
  deriveIndependentLoadProfile,
  type LoadInterval,
} from "./load-profile";

const startAt = new Date("2026-01-01T00:00:00Z");
const endAt = new Date("2026-01-01T00:15:00Z");
const interval = (kind: EnergyIntervalKind, kwh: number): LoadInterval => ({ kind, startAt, endAt, kwh });

describe("independent load profile", () => {
  it("uses direct site load and verifies it against the physical balance", () => {
    const result = deriveIndependentLoadProfile([
      interval(EnergyIntervalKind.PRODUCTION, 2),
      interval(EnergyIntervalKind.CONSUMPTION, 1.5),
      interval(EnergyIntervalKind.GRID_IMPORT, 0.2),
      interval(EnergyIntervalKind.GRID_EXPORT, 1),
      interval(EnergyIntervalKind.BATTERY, 0.3),
    ]);
    expect(result.points[0].consumptionKwh).toBe(1.5);
    expect(result.provenance).toMatchObject({ method: "DIRECT_SITE_LOAD", comparedIntervals: 1, mismatchedIntervals: 0 });
  });

  it("reconstructs load without inheriting historical battery dispatch", () => {
    const result = deriveIndependentLoadProfile([
      interval(EnergyIntervalKind.PRODUCTION, 0),
      interval(EnergyIntervalKind.GRID_IMPORT, 0.5),
      interval(EnergyIntervalKind.GRID_EXPORT, 0),
      interval(EnergyIntervalKind.BATTERY, 1),
    ]);
    expect(result.points[0].consumptionKwh).toBe(1.5);
    expect(result.provenance.method).toBe("POWER_BALANCE_RECONSTRUCTED");
  });

  it("rejects a vendor load channel that mirrors production and violates balance", () => {
    const result = deriveIndependentLoadProfile([
      interval(EnergyIntervalKind.PRODUCTION, 3),
      interval(EnergyIntervalKind.CONSUMPTION, 3),
      interval(EnergyIntervalKind.GRID_IMPORT, 0),
      interval(EnergyIntervalKind.GRID_EXPORT, 2.5),
      interval(EnergyIntervalKind.BATTERY, 0),
    ]);
    expect(result.points[0].consumptionKwh).toBe(0.5);
    expect(result.provenance).toMatchObject({
      method: "POWER_BALANCE_RECONSTRUCTED",
      comparedIntervals: 1,
      mismatchedIntervals: 1,
    });
  });

  it("sums every inverter before deriving the site load", () => {
    const aggregated = aggregateSiteIntervals([
      interval(EnergyIntervalKind.PRODUCTION, 2),
      interval(EnergyIntervalKind.PRODUCTION, 3),
      interval(EnergyIntervalKind.CONSUMPTION, -1),
      interval(EnergyIntervalKind.CONSUMPTION, 2.5),
    ]);
    const result = deriveIndependentLoadProfile(aggregated);

    expect(result.points).toHaveLength(1);
    expect(result.points[0]).toMatchObject({
      productionKwh: 5,
      consumptionKwh: 1.5,
    });
  });
});
