import { describe, expect, it } from "vitest";

import { nonProducingDayKeys, withoutNonProducingDays } from "./non-producing-days";

function day(date: string, production: number[], inverters = 2) {
  const out: Array<{ kind: string; startAt: Date; kwh: number; inverterId: number }> = [];
  for (let slot = 0; slot < 96; slot += 1) {
    const startAt = new Date(new Date(`${date}T00:00:00+02:00`).getTime() + slot * 900_000);
    for (let inverter = 1; inverter <= inverters; inverter += 1) {
      out.push({ kind: "PRODUCTION", startAt, kwh: (production[slot] ?? 0) / inverters, inverterId: inverter });
      out.push({ kind: "CONSUMPTION", startAt, kwh: 0.4, inverterId: inverter });
    }
  }
  return out;
}

describe("non-producing days", () => {
  it("marks a fully sampled day with production below 0.01 kWh/kWp and keeps a gloomy but producing day", () => {
    const dead = day("2026-04-12", Array(96).fill(0.001)); // 0.096 kWh from 20 kWp
    const gloomy = day("2025-12-04", Array(96).fill(0.0176)); // 1.69 kWh, a real winter day
    const sunny = day("2026-06-15", Array(96).fill(1.2));
    const days = nonProducingDayKeys([...dead, ...gloomy, ...sunny], { pvCapacityKwp: 20 });
    expect([...days]).toEqual(["2026-04-12"]);
    const kept = withoutNonProducingDays([...dead, ...gloomy, ...sunny], days);
    expect(kept.length).toBe(gloomy.length + sunny.length);
  });

  it("needs enough samples before calling a day non-producing", () => {
    const sparse = day("2026-05-03", Array(96).fill(0)).filter((_item, index) => index % 16 === 0); // 24 production samples
    expect(nonProducingDayKeys(sparse, { pvCapacityKwp: 20 }).size).toBe(0);
  });

  it("falls back to exactly zero when the capacity is unknown", () => {
    const tiny = day("2026-05-03", Array(96).fill(0.001));
    const zero = day("2026-05-04", Array(96).fill(0));
    expect([...nonProducingDayKeys([...tiny, ...zero], { pvCapacityKwp: null })]).toEqual(["2026-05-04"]);
  });
});
