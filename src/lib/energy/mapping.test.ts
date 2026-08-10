import { describe, expect, it } from "vitest";

import { mapLegacyDashboard, mapLegacyPlant } from "./mapping";

describe("legacy Spottex contract mapping", () => {
  it("maps only a complete plant contract", () => {
    expect(
      mapLegacyPlant({
        id: 42,
        device_id: 99,
        name: "Dům",
        optimization_running: 1,
        required_info: true,
        location: "Praha",
        pv_capacity_kwp: "9.9",
        battery_capacity_kwh: 11.6,
        inverter_model: "X3-HYBRID-G4",
        rated_power_kw: 10,
        serial_suffix: "1234",
      }),
    ).toEqual({
      siteId: "42",
      deviceId: "99",
      name: "Dům",
      optimizationOn: true,
      requiredInfo: false,
      location: "Praha",
      pvCapacityKwp: 9.9,
      batteryCapacityKwh: 11.6,
      inverterModel: "X3-HYBRID-G4",
      inverterRatedPowerKw: 10,
      inverterSerialSuffix: "1234",
      deviceCoverageStatus: "UNKNOWN",
      availableInverterRatedPowerKw: null,
      deviceCoveragePercent: null,
    });
    expect(
      mapLegacyPlant({
        id: 43,
        device_id: 100,
        required_info: false,
      }),
    ).toMatchObject({ requiredInfo: true });
    expect(mapLegacyPlant({ id: 42 })).toBeNull();
  });

  it("normalizes the reconstructed Flutter dashboard payload", () => {
    const now = new Date("2026-07-13T10:00:00.000Z");
    const snapshot = mapLegacyDashboard({
      now,
      selectedSiteId: 7,
      sites: [
        {
          id: 7,
          name: "FVE",
          provider: "LEGACY_SPOTTEX",
          status: "ONLINE",
          optimizationOn: false,
          requiredInfo: false,
          lastSyncedAt: null,
        },
      ],
      payload: {
        issues: [],
        soc: { soc: "64.5" },
        capacity: { capacity: 12.4 },
        price: { buy: "3.14", sell: 2.51 },
        inverter: {
          production_kwh: "4.2",
          consumption_kwh: 1.1,
          export_to_grid_kwh: 2.4,
          battery_flow_kwh: -0.7,
          optimization_running: true,
          access_token: "must-not-leak",
        },
        dailyEnergy: {
          production: [
            { time_from: "2026-07-13T09:00:00Z", time_to: "2026-07-13T10:00:00Z", kwh: 2 },
          ],
          consumption: [
            { time_from: "2026-07-13T09:00:00Z", time_to: "2026-07-13T10:00:00Z", kwh: 0.8 },
          ],
          battery: [
            { time_from: "2026-07-13T09:00:00Z", time_to: "2026-07-13T10:00:00Z", kwh: -0.3, soc_kwh: 11.5, battery_capacity_kwh: 23 },
          ],
          grid: [
            {
              time_from: "2026-07-13T09:00:00Z",
              time_to: "2026-07-13T10:00:00Z",
              import_kwh: 0.1,
              export_kwh: 1.2,
            },
          ],
        },
        savings: {
          savings_day_czk: 81,
          savings_week_czk: 490,
          savings_month_czk: 2010,
          savings_year_czk: 14500,
        },
        schedule: [
          {
            mode: "SELL",
            startTime: "2026-07-13T11:00:00Z",
            endTime: "2026-07-13T12:00:00Z",
            P_sell: 2,
            P_buy: 0,
            P_bat: -1.5,
            SOC: 45,
            cost: -4.2,
          },
        ],
      },
    });

    expect(snapshot.current).toMatchObject({
      productionKw: 4.2,
      consumptionKw: 1.1,
      gridKw: -2.4,
      batteryKw: 0.7,
      batterySocPct: 64.5,
      batteryCapacityKwh: null,
      pvCapacityKwp: 12.4,
      buyPriceCzk: 3.14,
      sellPriceCzk: 2.51,
    });
    expect(snapshot.dataTimestampKind).toBe("RECEIVED");
    expect(snapshot.inverterCount).toBe(1);
    expect(snapshot.sites[0].optimizationOn).toBe(true);
    expect(snapshot.dailySeries).toEqual([
      {
        at: "2026-07-13T09:00:00.000Z",
        endAt: "2026-07-13T10:00:00.000Z",
        predicted: false,
        productionKwh: 2,
        consumptionKwh: 0.8,
        batteryKwh: 0.3,
        batterySocKwh: 11.5,
        batteryCapacityKwh: 23,
        batterySocPct: 50,
        gridImportKwh: 0.1,
        gridExportKwh: 1.2,
      },
    ]);
    expect(snapshot.schedule[0]).toMatchObject({ mode: "SELL", sellKw: 2, targetSocPct: 45 });
    expect(JSON.stringify(snapshot)).not.toContain("must-not-leak");
  });

  it("keeps available telemetry when prices are unavailable", () => {
    const now = new Date("2026-07-13T10:00:00.000Z");
    const snapshot = mapLegacyDashboard({
      now,
      selectedSiteId: 7,
      sites: [{
        id: 7,
        name: "FVE",
        provider: "LEGACY_SPOTTEX",
        status: "ONLINE",
        optimizationOn: false,
        requiredInfo: true,
        lastSyncedAt: null,
      }],
      payload: {
        soc: { soc: 69 },
        capacity: { capacity: 14.9 },
        price: {},
        inverter: { production_kwh: 4.086, consumption_kwh: 3.706 },
        dailyEnergy: {},
        savings: {},
        schedule: {},
        issues: [{ section: "prices", message: "Ceny elektřiny nejsou dostupné." }],
      },
    });

    expect(snapshot.source).toBe("LIVE");
    expect(snapshot.dataAsOf).toBe("2026-07-13T10:00:00.000Z");
    expect(snapshot.current).toMatchObject({ productionKw: 4.086, consumptionKw: 3.706, buyPriceCzk: null });
    expect(snapshot.issues).toEqual([
      { section: "prices", message: "Ceny elektřiny nejsou dostupné." },
      { section: "savings", message: "Ověřený výpočet úspor zatím není dostupný." },
    ]);
  });

  it("normalizes legacy positive charging to the canonical negative battery flow", () => {
    const [point] = mapLegacyDashboard({
      now: new Date("2026-07-13T10:00:00.000Z"),
      selectedSiteId: 7,
      sites: [],
      payload: {
        issues: [],
        soc: {},
        capacity: {},
        price: {},
        inverter: {},
        dailyEnergy: {
          production: [{ time_from: "2026-07-13T09:00:00Z", kwh: 2 }],
          consumption: [{ time_from: "2026-07-13T09:00:00Z", kwh: 0.5 }],
          battery: [{ time_from: "2026-07-13T09:00:00Z", kwh: 0.3 }],
          grid: [{ time_from: "2026-07-13T09:00:00Z", import_kwh: 0, export_kwh: 1.2 }],
        },
        savings: {},
        schedule: {},
      },
    }).dailySeries;

    expect(point.batteryKwh).toBe(-0.3);
    expect(point.productionKwh + point.gridImportKwh + point.batteryKwh)
      .toBeCloseTo(point.consumptionKwh + point.gridExportKwh);
  });

  it("removes physically impossible night production from a prediction", () => {
    const [point] = mapLegacyDashboard({
      now: new Date("2026-07-27T20:00:00.000Z"),
      timezone: "Europe/Prague",
      selectedSiteId: 7,
      sites: [],
      payload: {
        issues: [],
        soc: {},
        capacity: {},
        price: {},
        inverter: {},
        dailyEnergy: {
          production: [
            {
              time_from: "2026-07-27T23:00:00Z",
              time_to: "2026-07-27T23:15:00Z",
              kwh: 2.5,
              prediction: true,
            },
          ],
        },
        savings: {},
        schedule: {},
      },
    }).dailySeries;

    expect(point.predicted).toBe(true);
    expect(point.productionKwh).toBe(0);
  });
});
