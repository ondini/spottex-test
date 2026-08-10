ALTER TABLE "tariff"."market_price_point"
ADD COLUMN "predicted" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "market_price_point_seriesId_predicted_startAt_idx"
ON "tariff"."market_price_point"("seriesId", "predicted", "startAt");
