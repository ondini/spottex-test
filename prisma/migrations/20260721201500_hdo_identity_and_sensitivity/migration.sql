ALTER TABLE "general"."energy_hdo_calendar"
  ADD COLUMN "eanSnapshot" TEXT,
  ADD COLUMN "distributorCode" TEXT,
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Europe/Prague',
  ADD COLUMN "retrievedAt" TIMESTAMP(3),
  ADD COLUMN "verifiedAt" TIMESTAMP(3);

ALTER TABLE "general"."energy_analysis_scenario"
  ADD COLUMN "annualCostLowerCzk" DECIMAL(14,2),
  ADD COLUMN "annualCostUpperCzk" DECIMAL(14,2);

CREATE INDEX "energy_hdo_calendar_eanSnapshot_distributorCode_validFrom_validTo_idx"
  ON "general"."energy_hdo_calendar"("eanSnapshot", "distributorCode", "validFrom", "validTo");
