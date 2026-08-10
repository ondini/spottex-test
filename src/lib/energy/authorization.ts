import { EnergyError } from "./types";

export type OwnedSite = { id: number; userId: number };

/**
 * Selects only from sites that were loaded for the authenticated user.
 * External device identifiers are deliberately not accepted at this boundary.
 */
export function selectOwnedSite<T extends OwnedSite>(
  sites: readonly T[],
  userId: number,
  requestedSiteId?: number | null,
): T {
  const owned = sites.filter((site) => site.userId === userId);
  if (owned.length === 0) {
    throw new EnergyError("NO_SITES", "K účtu zatím není připojena žádná elektrárna.", 404);
  }

  if (requestedSiteId == null) return owned[0];
  const selected = owned.find((site) => site.id === requestedSiteId);
  if (!selected) {
    // Do not reveal whether the requested id exists for another account.
    throw new EnergyError("SITE_NOT_FOUND", "Elektrárna nebyla nalezena.", 404);
  }
  return selected;
}

export function assertCommandOwnership(
  command: { requestedById: number; inverterId: number; type: string },
  expected: { userId: number; inverterId: number; type: string },
): void {
  if (
    command.requestedById !== expected.userId ||
    command.inverterId !== expected.inverterId ||
    command.type !== expected.type
  ) {
    throw new EnergyError(
      "CONFLICT",
      "Tento idempotency klíč už byl použit pro jiný příkaz.",
      409,
    );
  }
}
