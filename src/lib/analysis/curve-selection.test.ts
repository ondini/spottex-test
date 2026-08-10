import { describe, expect, it } from "vitest";

import { selectAnalysisCurveIds } from "./curve-selection";

const curves = [
  {
    id: "current",
    purpose: "CURRENT_BASELINE",
    buyMode: null,
    sellMode: null,
    distributionCode: "D02d",
  },
  {
    id: "fix-a",
    purpose: "CATALOG:1:1",
    buyMode: "FIX",
    sellMode: "FIX",
    distributionCode: "D02d",
    selectionScore: 200,
  },
  {
    id: "fix-b",
    purpose: "CATALOG:2:1",
    buyMode: "FIX",
    sellMode: "FIX",
    distributionCode: "D02d",
    selectionScore: 100,
  },
  {
    id: "spot",
    purpose: "CATALOG:3:1",
    buyMode: "SPOT",
    sellMode: "SPOT",
    distributionCode: "D02d",
  },
  {
    id: "fix-d57",
    purpose: "CATALOG:1:2",
    buyMode: "FIX",
    sellMode: "FIX",
    distributionCode: "D57d",
  },
  {
    id: "fix-spot",
    purpose: "CATALOG:4:1",
    buyMode: "FIX",
    sellMode: "SPOT",
    distributionCode: "D02d",
  },
  {
    id: "reference-d01",
    purpose: "REFERENCE_BASELINE:CEZ_D01D_NO_COMMITMENT",
    buyMode: "FIX",
    sellMode: "SPOT",
    distributionCode: "D01d",
  },
];

describe("analysis curve selection", () => {
  it("keeps the baseline and one representative per mode and distribution", () => {
    expect(selectAnalysisCurveIds(curves, false)).toEqual([
      "current",
      "fix-b",
      "spot",
      "fix-d57",
      "fix-spot",
      "reference-d01",
    ]);
  });

  it("keeps every catalog curve for the paid comparison", () => {
    expect(selectAnalysisCurveIds(curves, true)).toEqual(
      curves.map(({ id }) => id),
    );
  });
});
