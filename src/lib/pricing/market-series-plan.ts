// The daily OTE sync mostly just extends the horizon of the series it
// published yesterday. Re-creating a new series (and archiving the old one)
// for every extension produced a fresh row and a full point copy each day for
// nothing; when the start and source are unchanged, the published series is
// updated in place instead.
export function planMarketSeriesPublish(input: {
  current: { validFrom: Date; sourceUrl: string | null } | null;
  validFrom: Date;
  sourceUrl: string;
}): "EXTEND" | "CREATE" {
  const { current } = input;
  if (!current) return "CREATE";
  const sameStart = current.validFrom.getTime() === input.validFrom.getTime();
  return sameStart && current.sourceUrl === input.sourceUrl ? "EXTEND" : "CREATE";
}
