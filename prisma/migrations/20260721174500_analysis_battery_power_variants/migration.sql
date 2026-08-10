ALTER TABLE "general"."energy_analysis_scenario"
  ADD COLUMN "batteryMaxChargeKw" DOUBLE PRECISION,
  ADD COLUMN "batteryMaxDischargeKw" DOUBLE PRECISION;

UPDATE "general"."energy_analysis_scenario" AS scenario
SET
  "batteryMaxChargeKw" = COALESCE(profile."batteryMaxChargeKw", scenario."batteryCapacityKwh" * 0.5),
  "batteryMaxDischargeKw" = COALESCE(profile."batteryMaxDischargeKw", scenario."batteryCapacityKwh" * 0.5)
FROM "general"."energy_analysis_run" AS run
JOIN "general"."energy_site_technical_profile" AS profile
  ON profile."energySiteId" = run."energySiteId"
WHERE scenario."analysisRunId" = run.id;

UPDATE "general"."energy_analysis_scenario"
SET
  "batteryMaxChargeKw" = COALESCE("batteryMaxChargeKw", "batteryCapacityKwh" * 0.5),
  "batteryMaxDischargeKw" = COALESCE("batteryMaxDischargeKw", "batteryCapacityKwh" * 0.5);

ALTER TABLE "general"."energy_analysis_scenario"
  ALTER COLUMN "batteryMaxChargeKw" SET NOT NULL,
  ALTER COLUMN "batteryMaxDischargeKw" SET NOT NULL,
  ADD CONSTRAINT "energy_analysis_scenario_battery_charge_nonnegative" CHECK ("batteryMaxChargeKw" >= 0),
  ADD CONSTRAINT "energy_analysis_scenario_battery_discharge_nonnegative" CHECK ("batteryMaxDischargeKw" >= 0);
