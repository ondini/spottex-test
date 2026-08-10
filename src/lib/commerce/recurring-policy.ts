export const RECURRING_RENEWAL_MAX_ATTEMPTS = 3;
const DAY_MS = 86_400_000;

export function calculateRenewalAmount(input: {
  previousPaidMinor: number;
  latestOfferMinor?: number | null;
  mandateMaximumMinor: number;
  globalMaximumMinor: number;
}) {
  const candidates = [
    input.previousPaidMinor,
    input.latestOfferMinor ?? input.previousPaidMinor,
    input.mandateMaximumMinor,
    input.globalMaximumMinor,
  ];
  if (candidates.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error("RECURRING_RENEWAL_INVALID_AMOUNT");
  }
  return Math.min(...candidates);
}

export function recurringRetryAt(now: Date, attemptCount: number) {
  if (attemptCount >= RECURRING_RENEWAL_MAX_ATTEMPTS) return null;
  return new Date(now.getTime() + (attemptCount === 1 ? 1 : 3) * DAY_MS);
}
