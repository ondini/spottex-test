import { describe, expect, it } from "vitest";

import { csvCell, csvRow } from "./csv";

describe("analysis CSV", () => {
  it("quotes separators and neutralizes spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(\"bad\")")).toBe("\"'=HYPERLINK(\"\"bad\"\")\"");
    expect(csvRow(["A;B", 5])).toBe("\"A;B\";\"5\"");
  });
});
