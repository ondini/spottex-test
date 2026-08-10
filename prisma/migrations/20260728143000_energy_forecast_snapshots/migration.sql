CREATE TABLE "general"."energy_forecast_snapshot" (
    "id" BIGSERIAL NOT NULL,
    "inverterId" INTEGER NOT NULL,
    "kind" "general"."EnergyIntervalKind" NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "targetStartAt" TIMESTAMP(3) NOT NULL,
    "targetEndAt" TIMESTAMP(3) NOT NULL,
    "horizonMinutes" INTEGER NOT NULL,
    "predictedKwh" DOUBLE PRECISION NOT NULL,
    "actualKwh" DOUBLE PRECISION,
    "actualObservedAt" TIMESTAMP(3),
    "modelVersion" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "energy_forecast_snapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "energy_forecast_snapshot_inverterId_kind_generatedAt_targetStartAt_key"
ON "general"."energy_forecast_snapshot"("inverterId", "kind", "generatedAt", "targetStartAt");

CREATE INDEX "energy_forecast_snapshot_inverterId_kind_targetStartAt_idx"
ON "general"."energy_forecast_snapshot"("inverterId", "kind", "targetStartAt");

CREATE INDEX "energy_forecast_snapshot_actualObservedAt_targetStartAt_idx"
ON "general"."energy_forecast_snapshot"("actualObservedAt", "targetStartAt");

ALTER TABLE "general"."energy_forecast_snapshot"
ADD CONSTRAINT "energy_forecast_snapshot_inverterId_fkey"
FOREIGN KEY ("inverterId") REFERENCES "general"."inverter"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
