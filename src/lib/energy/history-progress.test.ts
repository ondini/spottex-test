import { describe, expect, it } from "vitest";

import { aggregateHistoryProgressBySite } from "./history-progress";

describe("history import progress", () => {
  it("adds every inverter import belonging to the same site", () => {
    const progress = aggregateHistoryProgressBySite([
      {
        energySiteId: 7,
        totalChunks: 19,
        succeededChunks: 8,
        failedChunks: 0,
        importedPoints: 1_200,
      },
      {
        energySiteId: 7,
        totalChunks: 19,
        succeededChunks: 11,
        failedChunks: 1,
        importedPoints: 2_300,
      },
      {
        energySiteId: 8,
        totalChunks: 19,
        succeededChunks: 2,
        failedChunks: 0,
        importedPoints: 300,
      },
    ]);

    expect(progress.get(7)).toEqual({
      totalChunks: 38,
      succeededChunks: 19,
      failedChunks: 1,
      importedPoints: 3_500,
    });
    expect(progress.get(8)?.totalChunks).toBe(19);
  });
});
