import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  mapLegacyTechnicalValues,
  technicalProfilePatchSchema,
  technicalReadiness,
} from "./technical-profile";

const complete = {
  ean: "859182400000000000",
  address: "Testovací 1",
  distributorCode: "CEZ_DISTRIBUCE",
  distributionTariffCode: "D25D",
  phases: 3,
  mainFuseA: 25,
  maxGridInputKw: 17.25,
  maxGridOutputKw: 9.9,
  exportAllowed: true,
  pvCapacityKwp: 9.9,
  batteryCapacityKwh: 11.6,
  batteryMaxChargeKw: 6.9,
  batteryMaxDischargeKw: 6.9,
  batteryMinSocPct: 15,
  batteryMaxSocPct: 100,
  batteryRoundtripEfficiencyPct: 92,
  buyPricingMode: "FIX",
  sellPricingMode: "SPOT",
  currentSupplierName: "ČEZ Prodej",
  currentProductName: "Fix na rok",
  monthlySupplierFeeCzk: 129,
  fixedBuyPriceCzkKwh: 2.5,
  fixedSellPriceCzkKwh: null,
  spotBuyFeeCzkKwh: null,
  spotSellFeeCzkKwh: 0.15,
  fixedPriceValidUntil: "2027-03-17T00:00:00.000Z",
  hdoStatus: "EXACT",
};

describe("technical profile readiness", () => {
  it("allows analysis and control only when their own required fields exist", () => {
    expect(technicalReadiness(complete)).toMatchObject({
      analysisReady: true,
      controlReady: true,
      analysisMissing: [],
      controlMissing: [],
    });
  });

  it("allows an estimate with pricing assumptions but blocks unsafe control", () => {
    const result = technicalReadiness({
      ...complete,
      distributorCode: null,
      distributionTariffCode: null,
      buyPricingMode: null,
      maxGridOutputKw: null,
      exportAllowed: null,
    });
    expect(result.analysisReady).toBe(true);
    expect(result.analysisAssumptions).toEqual(expect.arrayContaining([
      "distributorCode",
      "distributionTariffCode",
      "buyPricingMode",
    ]));
    expect(result.controlReady).toBe(false);
    expect(result.controlMissing).toEqual(expect.arrayContaining(["maxGridOutputKw", "exportAllowed"]));
  });

  it("requires the concrete price inputs used by live control", () => {
    expect(technicalReadiness({
      ...complete,
      fixedBuyPriceCzkKwh: null,
      spotSellFeeCzkKwh: null,
      fixedPriceValidUntil: null,
    }).controlMissing).toEqual(expect.arrayContaining([
      "fixedBuyPriceCzkKwh",
      "spotSellFeeCzkKwh",
      "fixedPriceValidUntil",
    ]));
  });

  it("validates panel and future appliance constraints", () => {
    expect(technicalProfilePatchSchema.safeParse({
      pvArrays: [{ name: "Jih", panelCount: 22, panelRatedWp: 450, nominalDcCapacityKwp: 9.9, active: true }],
      controlledAppliances: [{ name: "Bojler", type: "WATER_HEATER", status: "DECLARED", ratedPowerKw: 2.2, controllable: true, minRuntimeMinutes: 30, maxRuntimeMinutes: 180 }],
    }).success).toBe(true);
    expect(technicalProfilePatchSchema.safeParse({
      pvArrays: [{ name: "Jih", panelCount: 0, panelRatedWp: 450, nominalDcCapacityKwp: 9.9, active: true }],
    }).success).toBe(false);
    expect(technicalProfilePatchSchema.safeParse({
      controlledAppliances: [{ name: "Bojler", type: "WATER_HEATER", status: "DECLARED", ratedPowerKw: 2.2, controllable: true, minRuntimeMinutes: 180, maxRuntimeMinutes: 30 }],
    }).success).toBe(false);
  });

  it("maps persisted inverter and battery parameters from the legacy API", () => {
    expect(
      mapLegacyTechnicalValues({
        peak: 20,
        max_ac_kw: 20,
        battery_capacity_kwh: 23,
        bat_max_charge_kw: 6.9,
        bat_max_discharge_kw: 6.9,
      }).mapped,
    ).toMatchObject({
      pvCapacityKwp: 20,
      maxGridOutputKw: 20,
      batteryCapacityKwh: 23,
      batteryMaxChargeKw: 6.9,
      batteryMaxDischargeKw: 6.9,
    });
  });
});
