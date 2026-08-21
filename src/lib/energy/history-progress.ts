export type RunningHistoryImport = {
  energySiteId: number;
  totalChunks: number;
  succeededChunks: number;
  failedChunks: number;
  importedPoints: number;
};

export type SiteHistoryProgress = Omit<RunningHistoryImport, "energySiteId">;

export function aggregateHistoryProgressBySite(
  imports: RunningHistoryImport[],
) {
  const bySite = new Map<number, SiteHistoryProgress>();
  for (const item of imports) {
    const current = bySite.get(item.energySiteId) ?? {
      totalChunks: 0,
      succeededChunks: 0,
      failedChunks: 0,
      importedPoints: 0,
    };
    current.totalChunks += item.totalChunks;
    current.succeededChunks += item.succeededChunks;
    current.failedChunks += item.failedChunks;
    current.importedPoints += item.importedPoints;
    bySite.set(item.energySiteId, current);
  }
  return bySite;
}
