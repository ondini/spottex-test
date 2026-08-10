export type CurveSelectionCandidate = {
  id: string;
  purpose: string;
  buyMode: string | null;
  sellMode: string | null;
  distributionCode: string | null;
  selectionScore?: number;
};

/**
 * The free analysis compares the customer's baseline plus one representative
 * product for every pricing-mode/distribution-rate pair. Pro can request the
 * complete, immutable catalog snapshot used by the run.
 */
export function selectAnalysisCurveIds(
  curves: CurveSelectionCandidate[],
  compareAllTariffs: boolean,
) {
  if (compareAllTariffs) return curves.map((curve) => curve.id);
  const selected = new Set<string>();
  const groups = new Map<string, CurveSelectionCandidate>();
  for (const curve of curves) {
    if (
      curve.purpose === "CURRENT_BASELINE" ||
      curve.purpose.startsWith("REFERENCE_BASELINE:")
    ) {
      selected.add(curve.id);
      continue;
    }
    const group = `${curve.buyMode ?? "UNKNOWN"}:${curve.sellMode ?? "UNKNOWN"}:${curve.distributionCode ?? "UNKNOWN"}`;
    const current = groups.get(group);
    if (
      !current ||
      (curve.selectionScore ?? Number.POSITIVE_INFINITY) <
        (current.selectionScore ?? Number.POSITIVE_INFINITY)
    ) {
      groups.set(group, curve);
    }
  }
  for (const curve of groups.values()) selected.add(curve.id);
  return curves
    .filter((curve) => selected.has(curve.id))
    .map((curve) => curve.id);
}
