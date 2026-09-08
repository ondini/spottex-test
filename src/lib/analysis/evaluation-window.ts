// Which period an analysis evaluates and reports.
//
// The customer wants exact figures, not extrapolations: with less than ten
// months of complete measurements (about 300 days) the analysis covers the
// whole calendar months that are complete and reports costs for that period.
// With ten months or more the missing weeks are small enough to scale to a
// year, which is what the engine does with 365 / evaluatedDays.

export const ANNUAL_MINIMUM_DAYS = 300;
const COMPLETE_MONTH_PERCENT = 90;
const PRAGUE = "Europe/Prague";

export type EvaluationWindow = {
  from: Date;
  to: Date;
  annual: boolean;
  months: string[]; // "2026-06" … for the whole-month regime
};

function pragueOffsetMs(at: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: PRAGUE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
  return asUtc - at.getTime();
}

/** Midnight in Prague at the start of the given calendar month, as an instant. */
export function pragueMonthStart(year: number, month: number) {
  const guess = new Date(Date.UTC(year, month - 1, 1));
  return new Date(guess.getTime() - pragueOffsetMs(guess));
}

export function chooseEvaluationWindow(input: {
  window: { from: Date; to: Date };
  coverageDays: number;
  monthlyCoverage: Array<{ month: string; coveragePercent: number }>;
}): EvaluationWindow {
  if (input.coverageDays >= ANNUAL_MINIMUM_DAYS) {
    return { from: input.window.from, to: input.window.to, annual: true, months: [] };
  }
  const complete = input.monthlyCoverage
    .filter((item) => item.coveragePercent >= COMPLETE_MONTH_PERCENT)
    .map((item) => item.month)
    .sort();
  if (!complete.length) {
    return { from: input.window.from, to: input.window.to, annual: false, months: [] };
  }
  const [firstYear, firstMonth] = complete[0].split("-").map(Number);
  const [lastYear, lastMonth] = complete[complete.length - 1].split("-").map(Number);
  const from = new Date(Math.max(input.window.from.getTime(), pragueMonthStart(firstYear, firstMonth).getTime()));
  const to = new Date(Math.min(input.window.to.getTime(), pragueMonthStart(lastMonth === 12 ? lastYear + 1 : lastYear, lastMonth === 12 ? 1 : lastMonth + 1).getTime()));
  if (to <= from) {
    return { from: input.window.from, to: input.window.to, annual: false, months: [] };
  }
  return { from, to, annual: false, months: complete };
}

const CZECH_MONTHS_GENITIVE = ["ledna", "února", "března", "dubna", "května", "června", "července", "srpna", "září", "října", "listopadu", "prosince"];
const CZECH_MONTHS = ["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"];

/**
 * Human label for a reported period: "rok" when annual, "červen–červenec 2026"
 * when the window is whole months, otherwise the day range.
 */
export function evaluationPeriodLabel(input: { annual: boolean; from: Date | null; to: Date | null }) {
  if (input.annual) return "rok";
  if (!input.from || !input.to) return "měřené období";
  const day = new Intl.DateTimeFormat("cs-CZ", { timeZone: PRAGUE, day: "numeric", month: "numeric", year: "numeric" });
  const inPrague = (at: Date) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: PRAGUE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute") };
  };
  const start = inPrague(input.from);
  const endExclusive = inPrague(new Date(input.to.getTime() - 60_000));
  const wholeMonths = start.day === 1 && start.hour === 0 && start.minute === 0;
  const lastDayOfMonth = new Date(Date.UTC(endExclusive.year, endExclusive.month, 0)).getUTCDate();
  const endsAtMonthEnd = endExclusive.day === lastDayOfMonth && endExclusive.hour === 23 && endExclusive.minute >= 45;
  if (wholeMonths && endsAtMonthEnd) {
    if (start.year === endExclusive.year && start.month === endExclusive.month) return `${CZECH_MONTHS[start.month - 1]} ${start.year}`;
    if (start.year === endExclusive.year) return `${CZECH_MONTHS[start.month - 1]}–${CZECH_MONTHS[endExclusive.month - 1]} ${start.year}`;
    return `${CZECH_MONTHS[start.month - 1]} ${start.year} – ${CZECH_MONTHS[endExclusive.month - 1]} ${endExclusive.year}`;
  }
  return `${day.format(input.from)} – ${day.format(new Date(input.to.getTime() - 60_000))}`;
}

export function periodFactor(annual: boolean, evaluatedDays: number) {
  return annual ? 1 : Math.max(0, evaluatedDays) / 365;
}

export { CZECH_MONTHS_GENITIVE };
