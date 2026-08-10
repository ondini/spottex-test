import { describe, expect, it } from "vitest";

import { assertCommandOwnership, selectOwnedSite } from "./authorization";
import { EnergyError } from "./types";

describe("energy ownership boundary", () => {
  const sites = [
    { id: 10, userId: 1, name: "A" },
    { id: 20, userId: 2, name: "B" },
  ];

  it("returns only a site owned by the authenticated user", () => {
    expect(selectOwnedSite(sites, 1, 10)).toMatchObject({ id: 10, userId: 1 });
  });

  it("does not disclose a site belonging to another user", () => {
    expect(() => selectOwnedSite(sites, 1, 20)).toThrowError(
      expect.objectContaining<Partial<EnergyError>>({ code: "SITE_NOT_FOUND", status: 404 }),
    );
  });

  it("reports an account without sites without selecting a foreign default", () => {
    expect(() => selectOwnedSite(sites, 3)).toThrowError(
      expect.objectContaining<Partial<EnergyError>>({ code: "NO_SITES", status: 404 }),
    );
  });

  it("rejects reusing an idempotency key across users or commands", () => {
    const command = { requestedById: 1, inverterId: 5, type: "turnon" };
    expect(() =>
      assertCommandOwnership(command, { userId: 2, inverterId: 5, type: "turnon" }),
    ).toThrowError(expect.objectContaining<Partial<EnergyError>>({ code: "CONFLICT", status: 409 }));
    expect(() =>
      assertCommandOwnership(command, { userId: 1, inverterId: 5, type: "turnoff" }),
    ).toThrowError(expect.objectContaining<Partial<EnergyError>>({ code: "CONFLICT", status: 409 }));
  });
});
