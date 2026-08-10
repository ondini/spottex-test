import { describe, expect, it } from "vitest";

import golden from "./fixtures/study-milp-golden.json";
import { optimizeMilpHorizon } from "./milp";

describe("MILP regression against Study backend", () => {
  for (const fixture of golden.cases) {
    it(`matches physical flows for ${fixture.name}`, async () => {
      const start = new Date("2026-01-01T00:00:00.000Z");
      const points = fixture.productionKwh.map((productionKwh, index) => ({
        startAt: new Date(start.getTime() + index * 3_600_000),
        endAt: new Date(start.getTime() + (index + 1) * 3_600_000),
        productionKwh,
        consumptionKwh: fixture.consumptionKwh[index],
        totalBuyCzkKwh: fixture.buyCzkKwh[index],
        totalSellCzkKwh: fixture.sellCzkKwh[index],
      }));
      const plan = await optimizeMilpHorizon({
        points,
        battery: { capacityKwh: fixture.batteryCapacityKwh, maxChargeKw: 10, maxDischargeKw: 10, minSocPct: 0, maxSocPct: 100, roundtripEfficiencyPct: 100 },
        grid: { maxImportKw: 20, maxExportKw: 20, exportAllowed: true },
        initialSocKwh: fixture.initialSocKwh,
      });
      const actual = {
        importKwh: plan.points.map((point) => point.importKwh),
        exportKwh: plan.points.map((point) => point.exportKwh),
        chargeKwh: plan.points.map((point) => point.chargeKwh),
        dischargeKwh: plan.points.map((point) => point.dischargeKwh),
        socKwh: plan.points.map((point) => point.endingSocKwh),
      };
      for (const key of Object.keys(fixture.expected) as Array<keyof typeof fixture.expected>) {
        expect(actual[key]).toHaveLength(fixture.expected[key].length);
        actual[key].forEach((value, index) => expect(value).toBeCloseTo(fixture.expected[key][index], 4));
      }
    });
  }
});
