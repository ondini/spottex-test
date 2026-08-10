ALTER TABLE "analytics"."analytics_event"
  ADD COLUMN "deduplicationKey" TEXT;

CREATE UNIQUE INDEX "analytics_event_deduplicationKey_key"
  ON "analytics"."analytics_event"("deduplicationKey");
