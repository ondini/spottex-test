import { describe, expect, it } from "vitest";

import {
  generateWeekSlots,
  nextWeekReference,
  pragueDateParts,
  pragueWallClockToUtc,
} from "./time";

describe("Prague consultation time", () => {
  it("uses CET before and CEST after the spring DST jump", () => {
    const before = pragueWallClockToUtc(2026, 3, 29, 1, 30);
    const after = pragueWallClockToUtc(2026, 3, 29, 3, 30);

    expect(before.toISOString()).toBe("2026-03-29T00:30:00.000Z");
    expect(after.toISOString()).toBe("2026-03-29T01:30:00.000Z");
    expect(after.getTime() - before.getTime()).toBe(60 * 60_000);
  });

  it("uses CEST before and CET after the autumn DST fallback", () => {
    const before = pragueWallClockToUtc(2026, 10, 25, 1, 30);
    const repeatedHour = pragueWallClockToUtc(2026, 10, 25, 2, 30);
    const after = pragueWallClockToUtc(2026, 10, 25, 3, 30);

    expect(before.toISOString()).toBe("2026-10-24T23:30:00.000Z");
    expect(repeatedHour.toISOString()).toBe("2026-10-25T01:30:00.000Z");
    expect(after.toISOString()).toBe("2026-10-25T02:30:00.000Z");
    expect(after.getTime() - before.getTime()).toBe(3 * 60 * 60_000);
  });

  it("generates a Monday-to-Friday week of 30-minute slots", () => {
    const slots = generateWeekSlots(new Date("2026-07-15T12:00:00.000Z"));

    expect(slots).toHaveLength(5 * 8 * 2);
    expect(slots[0].startUtc.toISOString()).toBe("2026-07-13T07:00:00.000Z");
    expect(slots[0].endUtc.toISOString()).toBe("2026-07-13T07:30:00.000Z");
    expect(slots.at(-1)?.startUtc.toISOString()).toBe("2026-07-17T14:30:00.000Z");
    expect(slots.at(-1)?.endUtc.toISOString()).toBe("2026-07-17T15:00:00.000Z");

    expect(slots.every((slot) => slot.endUtc.getTime() - slot.startUtc.getTime() === 30 * 60_000)).toBe(true);
    expect(new Set(slots.map((slot) => slot.startUtc.toISOString())).size).toBe(slots.length);
    expect(new Set(slots.map((slot) => pragueDateParts(slot.startUtc).weekday))).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it("keeps the local Prague calendar date when UTC is already the next day locally", () => {
    expect(pragueDateParts(new Date("2026-07-12T22:30:00.000Z"))).toEqual({
      year: 2026,
      month: 7,
      day: 13,
      weekday: 1,
    });
  });

  it("moves a reference forward by exactly one week", () => {
    const reference = new Date("2026-03-25T10:15:00.000Z");
    expect(nextWeekReference(reference).toISOString()).toBe("2026-04-01T10:15:00.000Z");
  });
});

