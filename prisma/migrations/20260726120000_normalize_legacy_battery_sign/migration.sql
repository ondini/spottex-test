-- SolaX/legacy records battery charging as positive, while the Spottex
-- interval contract records battery discharge as positive. Preserve the
-- original interval values in the correction ledger before normalizing them.
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
    'LEGACY_BATTERY_SIGN_NORMALIZATION_V1',
    '20260726120000_normalize_legacy_battery_sign'
FROM "general"."energy_interval" AS interval
JOIN "general"."inverter" AS inverter
  ON inverter."id" = interval."inverterId"
WHERE inverter."provider" = 'LEGACY_SPOTTEX'::"general"."EnergyProvider"
  AND interval."kind" = 'BATTERY'::"general"."EnergyIntervalKind"
  AND interval."kwh" <> 0;

UPDATE "general"."energy_interval" AS interval
SET "kwh" = -interval."kwh"
FROM "general"."inverter" AS inverter
WHERE inverter."id" = interval."inverterId"
  AND inverter."provider" = 'LEGACY_SPOTTEX'::"general"."EnergyProvider"
  AND interval."kind" = 'BATTERY'::"general"."EnergyIntervalKind"
  AND interval."kwh" <> 0;

-- Current telemetry uses the same canonical sign in the application. Unlike
-- intervals, measurements have no correction ledger and are display cache
-- only, so they can be normalized in place.
UPDATE "general"."energy_measurement" AS measurement
SET "batteryKw" = -measurement."batteryKw"
FROM "general"."inverter" AS inverter
WHERE inverter."id" = measurement."inverterId"
  AND inverter."provider" = 'LEGACY_SPOTTEX'::"general"."EnergyProvider"
  AND measurement."batteryKw" IS NOT NULL
  AND measurement."batteryKw" <> 0;
