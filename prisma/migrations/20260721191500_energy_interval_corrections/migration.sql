CREATE TABLE "general"."energy_interval_correction" (
    "id" BIGSERIAL NOT NULL,
    "intervalId" BIGINT NOT NULL,
    "originalEndAt" TIMESTAMP(3) NOT NULL,
    "originalKwh" DOUBLE PRECISION NOT NULL,
    "originalPredicted" BOOLEAN NOT NULL,
    "correctedEndAt" TIMESTAMP(3) NOT NULL,
    "correctedKwh" DOUBLE PRECISION NOT NULL,
    "correctedPredicted" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "energy_interval_correction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "energy_interval_correction_intervalId_createdAt_idx"
ON "general"."energy_interval_correction"("intervalId", "createdAt");

ALTER TABLE "general"."energy_interval_correction"
ADD CONSTRAINT "energy_interval_correction_intervalId_fkey"
FOREIGN KEY ("intervalId") REFERENCES "general"."energy_interval"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
