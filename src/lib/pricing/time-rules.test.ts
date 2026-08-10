import { describe, expect, it } from "vitest";

import { compileTimeRules, timeRulesFormulaSchema } from "./time-rules";

const formula = { generatorId: "TIME_RULES_V1", schemaVersion: 1, buy: { baseCzkKwh: 3, rules: [{ fromMinute: 0, toMinute: 360, multiplier: 0.5 }, { fromMinute: 1080, toMinute: 1440, multiplier: 1.3 }] } } as const;

describe("audited time-rule price generator", () => {
  it("builds deterministic local-time percentages without executable code", () => {
    const points = compileTimeRules({ formula, direction: "BUY", validFrom: new Date("2026-01-01T00:00:00.000Z"), validTo: new Date("2026-01-02T00:00:00.000Z"), resolutionMinutes: 60, timezone: "Europe/Prague" });
    expect(points[0].value).toBe(1.5);
    expect(points[12].value).toBe(3);
    expect(points[20].value).toBe(3.9);
  });

  it("rejects unknown generators and unbounded rules", () => {
    expect(timeRulesFormulaSchema.safeParse({ generatorId: "AGENT_JS", schemaVersion: 1 }).success).toBe(false);
    expect(timeRulesFormulaSchema.safeParse({ ...formula, buy: { baseCzkKwh: 3, rules: [{ fromMinute: -1, toMinute: 4000 }] } }).success).toBe(false);
  });
});
