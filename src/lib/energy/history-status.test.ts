import { describe, expect, it } from "vitest";

import { describeHistoryStatus, monthLabel } from "./history-status";

const now = new Date("2026-09-08T12:00:00.000Z");

describe("history status for the analysis page", () => {
  it("names the missing months and allows a retry an hour after the last attempt", () => {
    const status = describeHistoryStatus({
      now,
      dataQuality: { coverageDays: 96.8, coveragePercent: 30, spanDays: 320, monthlyCoverage: [{ month: "2025-11", coveragePercent: 20 }, { month: "2025-12", coveragePercent: 0 }, { month: "2026-01", coveragePercent: 0 }, { month: "2026-02", coveragePercent: 80 }] },
      latestImport: { status: "COMPLETED", createdAt: new Date("2026-09-08T10:03:00.000Z"), completedAt: new Date("2026-09-08T10:21:00.000Z"), succeededChunks: 19, failedChunks: 0, totalChunks: 19, lastError: null },
      running: null,
      lastViewedAt: new Date("2026-09-08T11:00:00.000Z"),
    });
    expect(status.show).toBe(true);
    expect(status.missingMonths).toEqual(["listopad 2025", "prosinec 2025", "leden 2026"]);
    expect(status.lastAttempt?.outcome).toBe("COMPLETED");
    expect(status.canRetryNow).toBe(true);
    expect(status.nextAutomaticAt).toBe("2026-09-08T11:03:00.000Z");
  });

  it("shows progress and blocks a manual retry while an import runs", () => {
    const status = describeHistoryStatus({
      now,
      dataQuality: { coverageDays: 30, coveragePercent: 40, spanDays: 75, monthlyCoverage: [] },
      latestImport: { status: "RUNNING", createdAt: new Date("2026-09-08T11:50:00.000Z"), completedAt: null, succeededChunks: 4, failedChunks: 0, totalChunks: 19, lastError: null },
      running: { totalChunks: 38, doneChunks: 8, importedPoints: 5000 },
      lastViewedAt: null,
    });
    expect(status.running).toBe(true);
    expect(status.progress).toEqual({ totalChunks: 38, doneChunks: 8, importedPoints: 5000 });
    expect(status.canRetryNow).toBe(false);
    expect(status.nextAutomaticAt).toBeNull();
  });

  it("stays hidden when the history is complete", () => {
    const status = describeHistoryStatus({
      now,
      dataQuality: { coverageDays: 340, coveragePercent: 96, spanDays: 350, monthlyCoverage: [] },
      latestImport: null,
      running: null,
      lastViewedAt: null,
    });
    expect(status.show).toBe(false);
    expect(monthLabel("2026-03")).toBe("březen 2026");
  });
});
