import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { clampAnalysisWindow } from "./analysis-window";

const d = (value: string) => new Date(value);

describe("clampAnalysisWindow", () => {
  it("cuts measurements that start before the market series so SPOT stays comparable", () => {
    const result = clampAnalysisWindow(
      { from: d("2025-09-01T00:00:00Z"), to: d("2026-08-23T00:00:00Z") },
      { validFrom: d("2025-09-30T22:00:00Z"), validTo: d("2026-09-08T08:00:00Z") },
    );
    expect(result).toEqual({
      from: d("2025-09-30T22:00:00Z"),
      to: d("2026-08-23T00:00:00Z"),
      clamped: true,
      empty: false,
    });
  });

  it("leaves a window inside the series untouched", () => {
    const window = { from: d("2025-10-24T00:00:00Z"), to: d("2026-09-05T00:00:00Z") };
    const result = clampAnalysisWindow(window, {
      validFrom: d("2025-09-30T22:00:00Z"),
      validTo: d("2026-09-08T08:00:00Z"),
    });
    expect(result).toMatchObject({ ...window, clamped: false, empty: false });
  });

  it("passes the window through when no series is published", () => {
    const window = { from: d("2025-09-01T00:00:00Z"), to: d("2026-08-23T00:00:00Z") };
    expect(clampAnalysisWindow(window, null)).toMatchObject({ ...window, clamped: false, empty: false });
  });

  it("flags an empty overlap instead of inventing a window", () => {
    const result = clampAnalysisWindow(
      { from: d("2025-01-01T00:00:00Z"), to: d("2025-03-01T00:00:00Z") },
      { validFrom: d("2025-09-30T22:00:00Z"), validTo: d("2026-09-08T08:00:00Z") },
    );
    expect(result.empty).toBe(true);
  });
});
