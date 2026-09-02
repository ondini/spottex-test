import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requeueMocks = vi.hoisted(() => ({
  energySiteFindMany: vi.fn(),
  energySiteFindFirst: vi.fn(),
  historyImportFindFirst: vi.fn(),
  historyImportFindMany: vi.fn(),
  getEnergyDataQuality: vi.fn(),
  requestedSiteIds: [] as number[],
}));

vi.mock("@/lib/prisma", () => {
  const tx = {
    energyHistoryImport: {
      create: vi.fn(async ({ data }: { data: { energySiteId: number } }) => {
        requeueMocks.requestedSiteIds.push(data.energySiteId);
        return { id: `import-${requeueMocks.requestedSiteIds.length}`, ...data };
      }),
    },
    energyHistoryImportChunk: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: `chunk-${requeueMocks.requestedSiteIds.length}-${Date.now()}`, ...data })),
    },
    scheduledJob: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data) },
    auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data) },
  };
  return {
    prisma: {
      energySite: { findMany: requeueMocks.energySiteFindMany, findFirst: requeueMocks.energySiteFindFirst },
      energyHistoryImport: { findFirst: requeueMocks.historyImportFindFirst, findMany: requeueMocks.historyImportFindMany },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    },
  };
});

vi.mock("./data-quality", () => ({
  getEnergyDataQuality: requeueMocks.getEnergyDataQuality,
  invalidateEnergyDataQualityCache: vi.fn(),
}));

import {
  historyChunks,
  requeueSparseHistoryImports,
  shouldRequeueSparseHistoryImport,
  shouldRetryEmptyHistoryChunk,
} from "./history-import";

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

  it("accepts a genuinely empty older range after a later range has data", () => {
    expect(shouldRetryEmptyHistoryChunk({ attempts: 2, maxAttempts: 8, hasLaterSuccessfulChunk: true })).toBe(false);
    expect(shouldRetryEmptyHistoryChunk({ attempts: 2, maxAttempts: 8, hasLaterSuccessfulChunk: false })).toBe(true);
    expect(shouldRetryEmptyHistoryChunk({ attempts: 8, maxAttempts: 8, hasLaterSuccessfulChunk: false })).toBe(false);
  });
});

describe("sparse history import requeue", () => {
  const now = new Date("2026-09-02T12:00:00.000Z");
  const dayOld = new Date(now.getTime() - 25 * 60 * 60_000);

  type SiteFixture = {
    id: number;
    userId: number;
    batch?: string[];
    coveragePercent?: number;
    coverageDays?: number;
    qualityError?: boolean;
  };

  function primeSites(sites: SiteFixture[]) {
    requeueMocks.energySiteFindMany.mockResolvedValue(sites.map((site) => ({ id: site.id, userId: site.userId })));
    requeueMocks.historyImportFindFirst.mockImplementation(
      async (args: { where: { energySiteId: number; status?: unknown } }) =>
        // A where clause with a status filter is requestHistoryImport's
        // active-import check; without it, it is the latest-import lookup.
        args.where.status
          ? null
          : {
              requestedFrom: new Date("2025-09-01T00:00:00.000Z"),
              requestedTo: new Date("2026-09-01T00:00:00.000Z"),
              createdAt: dayOld,
            },
    );
    requeueMocks.historyImportFindMany.mockImplementation(
      async (args: { where: { energySiteId: number } }) =>
        (sites.find((site) => site.id === args.where.energySiteId)?.batch ?? ["COMPLETED"]).map((status) => ({ status })),
    );
    requeueMocks.getEnergyDataQuality.mockImplementation(async (_userId: number, siteId: number) => {
      const site = sites.find((item) => item.id === siteId);
      if (site?.qualityError) throw new Error("QUALITY_UNAVAILABLE");
      return { coveragePercent: site?.coveragePercent ?? 40, coverageDays: site?.coverageDays ?? 120 };
    });
    requeueMocks.energySiteFindFirst.mockImplementation(
      async (args: { where: { id: number; userId: number } }) => ({
        id: args.where.id,
        userId: args.where.userId,
        provider: "LEGACY_SPOTTEX",
        inverters: [{ id: 900 + args.where.id }],
      }),
    );
  }

  beforeEach(() => {
    requeueMocks.energySiteFindMany.mockReset();
    requeueMocks.energySiteFindFirst.mockReset();
    requeueMocks.historyImportFindFirst.mockReset();
    requeueMocks.historyImportFindMany.mockReset();
    requeueMocks.getEnergyDataQuality.mockReset();
    requeueMocks.requestedSiteIds.length = 0;
  });

  it("requeues only a day-old fully terminal batch with sparse coverage", () => {
    const base = {
      now,
      latestImportCreatedAt: dayOld,
      batchStatuses: ["PARTIAL", "COMPLETED", "FAILED"],
      coveragePercent: 40,
      coverageDays: 120,
    };
    expect(shouldRequeueSparseHistoryImport(base)).toBe(true);
    expect(shouldRequeueSparseHistoryImport({ ...base, latestImportCreatedAt: new Date(now.getTime() - 60_000) })).toBe(false);
    expect(shouldRequeueSparseHistoryImport({ ...base, batchStatuses: ["PARTIAL", "RUNNING"] })).toBe(false);
    expect(shouldRequeueSparseHistoryImport({ ...base, batchStatuses: ["PARTIAL", "QUEUED"] })).toBe(false);
    expect(shouldRequeueSparseHistoryImport({ ...base, batchStatuses: ["PARTIAL", "CANCELED"] })).toBe(false);
    expect(shouldRequeueSparseHistoryImport({ ...base, batchStatuses: [] })).toBe(false);
    expect(shouldRequeueSparseHistoryImport({ ...base, coveragePercent: 75 })).toBe(false);
    expect(shouldRequeueSparseHistoryImport({ ...base, coverageDays: 0.5 })).toBe(false);
  });

  it("requeues sparse sites and skips covered or canceled ones", async () => {
    primeSites([
      { id: 1, userId: 11, coveragePercent: 40 },
      { id: 2, userId: 12, coveragePercent: 90 },
      { id: 3, userId: 13, batch: ["COMPLETED", "CANCELED"] },
    ]);
    const summary = await requeueSparseHistoryImports(now);
    expect(summary).toEqual({ checked: 3, requeued: 1 });
    expect(requeueMocks.requestedSiteIds).toEqual([1]);
    expect(requeueMocks.energySiteFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ provider: "LEGACY_SPOTTEX" }),
      }),
    );
  });

  it("continues with the remaining sites when one site's check fails", async () => {
    primeSites([
      { id: 1, userId: 11, qualityError: true },
      { id: 2, userId: 12, coveragePercent: 30 },
    ]);
    const summary = await requeueSparseHistoryImports(now);
    expect(summary).toEqual({ checked: 2, requeued: 1 });
    expect(requeueMocks.requestedSiteIds).toEqual([2]);
  });

  it("caps requeues per invocation to bound the job runner cycle", async () => {
    primeSites([
      { id: 1, userId: 11 },
      { id: 2, userId: 12 },
      { id: 3, userId: 13 },
      { id: 4, userId: 14 },
    ]);
    const summary = await requeueSparseHistoryImports(now);
    expect(summary).toEqual({ checked: 3, requeued: 3 });
    expect(requeueMocks.requestedSiteIds).toEqual([1, 2, 3]);
  });
});
