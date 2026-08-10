import { z } from "zod";

import type { TimeValue } from "./curve";

const ruleSchema = z.object({
  months: z.array(z.number().int().min(1).max(12)).max(12).optional(),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
  fromMinute: z.number().int().min(0).max(1439),
  toMinute: z.number().int().min(1).max(1440),
  multiplier: z.number().finite().min(0).max(10).default(1),
  addCzkKwh: z.number().finite().min(-50).max(50).default(0),
}).strict();

const directionSchema = z.object({ baseCzkKwh: z.number().finite().min(-20).max(50), rules: z.array(ruleSchema).max(100).default([]) }).strict();

export const timeRulesFormulaSchema = z.object({
  generatorId: z.literal("TIME_RULES_V1"),
  schemaVersion: z.literal(1),
  buy: directionSchema.optional(),
  sell: directionSchema.optional(),
}).strict();

function localParts(at: Date, timezone: string) {
  const entries = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, month: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const values = Object.fromEntries(entries.map((entry) => [entry.type, entry.value]));
  const weekday = ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[values.weekday];
  return { month: Number(values.month), weekday, minute: Number(values.hour) * 60 + Number(values.minute) };
}

export function compileTimeRules(input: { formula: unknown; direction: "BUY" | "SELL"; validFrom: Date; validTo: Date; resolutionMinutes: 15 | 60; timezone: string }): TimeValue[] {
  const formula = timeRulesFormulaSchema.parse(input.formula);
  const direction = input.direction === "BUY" ? formula.buy : formula.sell;
  if (!direction) throw new Error(`PRICE_CURVE_TIME_RULES_${input.direction}_MISSING`);
  const stepMs = input.resolutionMinutes * 60_000;
  const points: TimeValue[] = [];
  for (let timestamp = input.validFrom.getTime(); timestamp < input.validTo.getTime(); timestamp += stepMs) {
    const local = localParts(new Date(timestamp), input.timezone);
    const rule = direction.rules.find((candidate) => {
      const inTime = candidate.fromMinute < candidate.toMinute
        ? local.minute >= candidate.fromMinute && local.minute < candidate.toMinute
        : local.minute >= candidate.fromMinute || local.minute < candidate.toMinute;
      return inTime && (!candidate.months || candidate.months.includes(local.month)) && (!candidate.weekdays || candidate.weekdays.includes(local.weekday));
    });
    const value = rule ? direction.baseCzkKwh * rule.multiplier + rule.addCzkKwh : direction.baseCzkKwh;
    points.push({ startAt: new Date(timestamp), endAt: new Date(timestamp + stepMs), value: Math.round(value * 1_000_000) / 1_000_000 });
  }
  return points;
}
