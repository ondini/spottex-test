DROP INDEX IF EXISTS "payment"."payment_provider_providerPaymentId_idx";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "payment"."payment"
    WHERE "providerPaymentId" IS NOT NULL
    GROUP BY "provider", "providerPaymentId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce GoPay payment identity: duplicate provider/providerPaymentId rows exist';
  END IF;
END $$;

ALTER TABLE "consultation"."consultation_booking"
  ADD COLUMN "manageTokenExpiresAt" TIMESTAMP(3);

UPDATE "consultation"."consultation_booking" AS booking
SET "manageTokenExpiresAt" = CASE
  WHEN booking."status" IN ('PENDING', 'CONFIRMED')
    THEN slot."endUtc" + INTERVAL '7 days'
  ELSE NOW()
END
FROM "consultation"."consultation_slot" AS slot
WHERE slot."id" = booking."slotId";

ALTER TABLE "consultation"."consultation_booking"
  ALTER COLUMN "manageTokenExpiresAt" SET NOT NULL;

ALTER TABLE "general"."users"
  ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "jobs"."rate_limit_bucket" (
  "key" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "rate_limit_bucket_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "rate_limit_bucket_expiresAt_idx"
  ON "jobs"."rate_limit_bucket"("expiresAt");

CREATE UNIQUE INDEX "payment_provider_providerPaymentId_key"
  ON "payment"."payment"("provider", "providerPaymentId");
