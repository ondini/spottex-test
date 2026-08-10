ALTER TABLE "general"."energy_analysis_run"
  ADD COLUMN "catalogComparisonPriceMinor" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "general"."energy_analysis_run"
  DROP CONSTRAINT "energy_analysis_run_price_check",
  ADD CONSTRAINT "energy_analysis_run_price_check" CHECK (
    "pricePerExtraPointMinor" >= 0 AND
    "catalogComparisonPriceMinor" >= 0 AND
    "proPriceMinor" >= 0 AND
    "proPriceMinor" =
      "billablePointCount" * "pricePerExtraPointMinor" +
      "catalogComparisonPriceMinor"
  );
