import { describe, expect, it } from "vitest";

import type { LegacyPlant } from "./types";
import {
  plantCapacityKwp,
  selectLegacyRegistrationRows,
} from "./service";

const basePlant: LegacyPlant = {
  siteId: "34",
  deviceId: "36",
  name: "MS Vetrnik",
  optimizationOn: false,
  requiredInfo: true,
  location: null,
  pvCapacityKwp: 10,
  batteryCapacityKwh: 11.6,
  inverterModel: "X3-Hybrid-G4",
  inverterRatedPowerKw: 10,
  inverterSerialSuffix: "672033",
  deviceCoverageStatus: "COMPLETE",
  availableInverterRatedPowerKw: 20,
  deviceCoveragePercent: 100,
};

describe("legacy registration selection", () => {
  it("accepts multiple inverter rows belonging to one selected plant", () => {
    const rows = selectLegacyRegistrationRows(
      [
        basePlant,
        {
          ...basePlant,
          deviceId: "37",
          inverterSerialSuffix: "671392",
        },
      ],
      ["34"],
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.deviceId)).toEqual(["36", "37"]);
  });

  it("rejects a response missing any selected plant", () => {
    expect(() =>
      selectLegacyRegistrationRows([basePlant], ["34", "35"]),
    ).toThrow("Energetická služba nevrátila všechny vybrané elektrárny.");
  });

  it("keeps plant capacity when live telemetry describes one inverter", () => {
    expect(
      plantCapacityKwp(
        {
          pvCapacityKwp: 20,
          deviceCoverage: { expectedCapacityKwp: 20 },
        },
        10,
      ),
    ).toBe(20);
  });
});
