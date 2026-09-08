// What the analysis page says about a plant's history: how much of the last
// year is there, which months are missing, what the last download attempt did
// and whether another one is due. Pure, so the wording is testable.

export type HistoryStatusInput = {
  dataQuality: {
    coverageDays: number;
    coveragePercent: number;
    spanDays: number;
    monthlyCoverage: Array<{ month: string; coveragePercent: number }>;
  };
  latestImport: {
    status: string;
    createdAt: Date;
    completedAt: Date | null;
    succeededChunks: number;
    failedChunks: number;
    totalChunks: number;
    lastError: string | null;
  } | null;
  running: { totalChunks: number; doneChunks: number; importedPoints: number } | null;
  lastViewedAt: Date | null;
  now?: Date;
};

export type HistoryStatus = {
  show: boolean;
  running: boolean;
  coverageDays: number;
  coveragePercent: number;
  missingMonths: string[];
  progress: { doneChunks: number; totalChunks: number; importedPoints: number } | null;
  lastAttempt: {
    at: string;
    outcome: "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELED" | "RUNNING";
    succeededChunks: number;
    failedChunks: number;
    totalChunks: number;
    error: string | null;
  } | null;
  nextAutomaticAt: string | null;
  canRetryNow: boolean;
};

const COVERAGE_TARGET_PERCENT = 75;
const RETRY_MIN_AGE_MS = 60 * 60_000;
const RECENT_VIEW_MS = 5 * 86_400_000;
const CZECH_MONTHS = ["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"];

export function monthLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  return `${CZECH_MONTHS[(month ?? 1) - 1] ?? key} ${year}`;
}

export function describeHistoryStatus(input: HistoryStatusInput): HistoryStatus {
  const now = input.now ?? new Date();
  const missingMonths = input.dataQuality.monthlyCoverage
    .filter((item) => item.coveragePercent < 50)
    .map((item) => monthLabel(item.month));
  const running = Boolean(input.running) || ["QUEUED", "RUNNING"].includes(input.latestImport?.status ?? "");
  const sparse = input.dataQuality.coverageDays < 1 || input.dataQuality.coveragePercent < COVERAGE_TARGET_PERCENT;
  const lastAttempt = input.latestImport
    ? {
        at: (input.latestImport.completedAt ?? input.latestImport.createdAt).toISOString(),
        outcome: (["COMPLETED", "PARTIAL", "FAILED", "CANCELED"].includes(input.latestImport.status)
          ? input.latestImport.status
          : "RUNNING") as HistoryStatus["lastAttempt"] extends infer T ? (T extends { outcome: infer O } ? O : never) : never,
        succeededChunks: input.latestImport.succeededChunks,
        failedChunks: input.latestImport.failedChunks,
        totalChunks: input.latestImport.totalChunks,
        error: input.latestImport.lastError,
      }
    : null;
  const lastAttemptAge = input.latestImport ? now.getTime() - input.latestImport.createdAt.getTime() : Number.POSITIVE_INFINITY;
  const recentlyViewed = input.lastViewedAt ? now.getTime() - input.lastViewedAt.getTime() <= RECENT_VIEW_MS : false;
  const nextAutomaticAt =
    sparse && !running && input.latestImport
      ? new Date(input.latestImport.createdAt.getTime() + (recentlyViewed ? RETRY_MIN_AGE_MS : 24 * 3_600_000)).toISOString()
      : null;
  return {
    show: sparse || running,
    running,
    coverageDays: input.dataQuality.coverageDays,
    coveragePercent: input.dataQuality.coveragePercent,
    missingMonths,
    progress: input.running,
    lastAttempt,
    nextAutomaticAt,
    canRetryNow: !running && lastAttemptAge >= RETRY_MIN_AGE_MS,
  };
}
