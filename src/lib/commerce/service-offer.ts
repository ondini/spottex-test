export const CONTROL_LIST_PRICE_MINOR = 99_000;
export const CONTROL_SAVINGS_SHARE_BPS = 2_500;

export function calculateAnnualControlOffer(expectedControlSavingsMinor: number, options?: {
  listPriceMinor?: number;
  savingsShareBps?: number;
}) {
  if (!Number.isSafeInteger(expectedControlSavingsMinor)) throw new Error("OFFER_INVALID_SAVINGS");
  const savingsMinor = Math.max(0, expectedControlSavingsMinor);
  const listPriceMinor = options?.listPriceMinor ?? CONTROL_LIST_PRICE_MINOR;
  const savingsShareBps = options?.savingsShareBps ?? CONTROL_SAVINGS_SHARE_BPS;
  if (!Number.isSafeInteger(listPriceMinor) || listPriceMinor < 0) throw new Error("OFFER_INVALID_LIST_PRICE");
  if (!Number.isSafeInteger(savingsShareBps) || savingsShareBps < 0 || savingsShareBps > 10_000) {
    throw new Error("OFFER_INVALID_SHARE");
  }
  const proportionalPriceMinor = Math.round(savingsMinor * savingsShareBps / 10_000);
  const finalPriceMinor = Math.min(listPriceMinor, proportionalPriceMinor);
  const discountMinor = listPriceMinor - finalPriceMinor;
  const discountPercent = listPriceMinor > 0 ? Math.round(discountMinor / listPriceMinor * 100) : 0;
  return {
    expectedControlSavingsMinor: savingsMinor,
    listPriceMinor,
    savingsShareBps,
    proportionalPriceMinor,
    finalPriceMinor,
    discountMinor,
    discountPercent,
  };
}
