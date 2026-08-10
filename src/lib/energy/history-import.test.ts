import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { historyChunks } from "./history-import";

describe("history import chunking", () => {
  it("splits a window into deterministic non-overlapping chunks", () => {
    const chunks = historyChunks(
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-01-02T06:00:00.000Z"),
      12 * 60 * 60_000,
    );
    expect(chunks).toEqual([
      { from: new Date("2026-01-01T00:00:00.000Z"), to: new Date("2026-01-01T12:00:00.000Z") },
      { from: new Date("2026-01-01T12:00:00.000Z"), to: new Date("2026-01-02T00:00:00.000Z") },
      { from: new Date("2026-01-02T00:00:00.000Z"), to: new Date("2026-01-02T06:00:00.000Z") },
    ]);
  });

  it("rejects reversed windows", () => {
    expect(() => historyChunks(new Date("2026-01-02T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z"))).toThrow("HISTORY_IMPORT_INVALID_WINDOW");
  });
});
