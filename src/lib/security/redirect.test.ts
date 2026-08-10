import { describe, expect, it } from "vitest";

import { safeInternalPath } from "@/lib/security/redirect";

describe("safeInternalPath", () => {
  it("keeps a normal internal callback including query parameters", () => {
    expect(safeInternalPath("/app/faktury?stav=paid")).toBe("/app/faktury?stav=paid");
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/%5cevil.example", "\n/evil"])(
    "rejects an external or browser-normalized callback: %s",
    (value) => expect(safeInternalPath(value)).toBe("/app/dashboard"),
  );
});
