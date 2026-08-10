import { describe, expect, it } from "vitest";

import {
  hasMaterialUnservedEnergy,
  unservedEnergyToleranceKwh,
} from "./eligibility";

describe("analysis scenario eligibility", () => {
  it("tolerates only a negligible breaker-overload residue", () => {
    expect(unservedEnergyToleranceKwh(9_000)).toBeCloseTo(0.9);
    expect(hasMaterialUnservedEnergy(0.595, 9_000)).toBe(false);
  });

  it("rejects a material share even when it is below one kWh", () => {
    expect(hasMaterialUnservedEnergy(0.5, 100)).toBe(true);
  });

  it("caps the tolerance at one kWh for large consumers", () => {
    expect(unservedEnergyToleranceKwh(100_000)).toBe(1);
    expect(hasMaterialUnservedEnergy(1.01, 100_000)).toBe(true);
  });
});
