-- A live application can refresh an interval while the preceding migration is
-- being deployed. Reconcile every complete legacy interval against the
-- physical energy balance so deployment order cannot leave an already
-- normalized value with its sign flipped a second time.
CREATE TEMPORARY TABLE "_legacy_battery_sign_reconciliation" ON COMMIT DROP AS
SELECT battery."id"
FROM "general"."energy_interval" AS battery
JOIN "general"."inverter" AS inverter
  ON inverter."id" = battery."inverterId"
JOIN "general"."energy_interval" AS production
  ON production."inverterId" = battery."inverterId"
 AND production."startAt" = battery."startAt"
 AND production."kind" = 'PRODUCTION'::"general"."EnergyIntervalKind"
JOIN "general"."energy_interval" AS consumption
  ON consumption."inverterId" = battery."inverterId"
 AND consumption."startAt" = battery."startAt"
 AND consumption."kind" = 'CONSUMPTION'::"general"."EnergyIntervalKind"
JOIN "general"."energy_interval" AS grid_import
  ON grid_import."inverterId" = battery."inverterId"
 AND grid_import."startAt" = battery."startAt"
 AND grid_import."kind" = 'GRID_IMPORT'::"general"."EnergyIntervalKind"
JOIN "general"."energy_interval" AS grid_export
  ON grid_export."inverterId" = battery."inverterId"
 AND grid_export."startAt" = battery."startAt"
 AND grid_export."kind" = 'GRID_EXPORT'::"general"."EnergyIntervalKind"
WHERE inverter."provider" = 'LEGACY_SPOTTEX'::"general"."EnergyProvider"
  AND battery."kind" = 'BATTERY'::"general"."EnergyIntervalKind"
  AND battery."kwh" <> 0
  AND ABS(
    production."kwh" + grid_import."kwh" + battery."kwh"
    - consumption."kwh" - grid_export."kwh"
  ) > ABS(
    production."kwh" + grid_import."kwh" - battery."kwh"
    - consumption."kwh" - grid_export."kwh"
  ) + 1e-9;

INSERT INTO "general"."energy_interval_correction" (
    "intervalId",
    "originalEndAt",
    "originalKwh",
    "originalPredicted",
    "correctedEndAt",
    "correctedKwh",
    "correctedPredicted",
    "reason",
    "sourceReference"
)
SELECT
    interval."id",
    interval."endAt",
    interval."kwh",
    interval."predicted",
    interval."endAt",
    -interval."kwh",
    interval."predicted",
    'LEGACY_BATTERY_BALANCE_RECONCILIATION_V1',
    '20260726120100_reconcile_legacy_battery_balance'
FROM "general"."energy_interval" AS interval
JOIN "_legacy_battery_sign_reconciliation" AS reconciliation
  ON reconciliation."id" = interval."id";

UPDATE "general"."energy_interval" AS interval
SET "kwh" = -interval."kwh"
FROM "_legacy_battery_sign_reconciliation" AS reconciliation
WHERE reconciliation."id" = interval."id";
