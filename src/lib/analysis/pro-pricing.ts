export const PRO_EXTRA_POINT_PRICE_MINOR = 1_000;
export const PRO_ALL_TARIFFS_PRICE_MINOR = 10_000;

export function calculateProAnalysisPriceMinor(input: {
  billablePointCount: number;
  compareAllTariffs: boolean;
  pricePerExtraPointMinor?: number;
}) {
  return (
    input.billablePointCount *
      (input.pricePerExtraPointMinor ?? PRO_EXTRA_POINT_PRICE_MINOR) +
    (input.compareAllTariffs ? PRO_ALL_TARIFFS_PRICE_MINOR : 0)
  );
}
