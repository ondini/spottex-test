-- CreateEnum
CREATE TYPE "general"."EnergyAnalysisStatus" AS ENUM ('DRAFT', 'WAITING_FOR_DATA', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "general"."EnergyAnalysisKind" AS ENUM ('BASE', 'PRO');

-- CreateEnum
CREATE TYPE "general"."AnalysisControlMode" AS ENUM ('SELF_USE', 'SMART');

-- CreateEnum
CREATE TYPE "general"."AnalysisScenarioStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'INELIGIBLE');

-- AlterTable
ALTER TABLE "payment"."service_offer" ADD COLUMN     "analysisRunId" TEXT;

-- CreateTable
CREATE TABLE "general"."energy_analysis_run" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "energySiteId" INTEGER NOT NULL,
    "status" "general"."EnergyAnalysisStatus" NOT NULL DEFAULT 'DRAFT',
    "kind" "general"."EnergyAnalysisKind" NOT NULL DEFAULT 'BASE',
    "engineVersion" TEXT NOT NULL,
    "methodologyVersion" TEXT NOT NULL,
    "inputFingerprint" TEXT NOT NULL,
    "dataFrom" TIMESTAMP(3),
    "dataTo" TIMESTAMP(3),
    "confidence" TEXT,
    "requestedPointCount" INTEGER NOT NULL DEFAULT 0,
    "includedPointCount" INTEGER NOT NULL DEFAULT 0,
    "billablePointCount" INTEGER NOT NULL DEFAULT 0,
    "pricePerExtraPointMinor" INTEGER NOT NULL DEFAULT 500,
    "proPriceMinor" INTEGER NOT NULL DEFAULT 0,
    "inputs" JSONB NOT NULL DEFAULT '{}',
    "assumptions" JSONB NOT NULL DEFAULT '{}',
    "sourceVersions" JSONB NOT NULL DEFAULT '{}',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "energy_analysis_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "general"."energy_analysis_scenario" (
    "id" TEXT NOT NULL,
    "analysisRunId" TEXT NOT NULL,
    "scenarioKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "general"."AnalysisScenarioStatus" NOT NULL DEFAULT 'QUEUED',
    "controlMode" "general"."AnalysisControlMode" NOT NULL,
    "priceCurveId" TEXT NOT NULL,
    "batteryCapacityKwh" DOUBLE PRECISION NOT NULL,
    "pvCapacityKwp" DOUBLE PRECISION NOT NULL,
    "maxGridInputKw" DOUBLE PRECISION,
    "maxGridOutputKw" DOUBLE PRECISION,
    "annualCostCzk" DECIMAL(14,2),
    "annualImportCostCzk" DECIMAL(14,2),
    "annualExportRevenueCzk" DECIMAL(14,2),
    "annualFixedCostCzk" DECIMAL(14,2),
    "savingsVsBaselineCzk" DECIMAL(14,2),
    "savingsVsSelfUseCzk" DECIMAL(14,2),
    "importedKwh" DOUBLE PRECISION,
    "exportedKwh" DOUBLE PRECISION,
    "chargedKwh" DOUBLE PRECISION,
    "dischargedKwh" DOUBLE PRECISION,
    "batteryCycles" DOUBLE PRECISION,
    "peakImportKw" DOUBLE PRECISION,
    "result" JSONB NOT NULL DEFAULT '{}',
    "assumptions" JSONB NOT NULL DEFAULT '{}',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "energy_analysis_scenario_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "general"."energy_analysis_run"
  ADD CONSTRAINT "energy_analysis_run_points_check" CHECK (
    "requestedPointCount" >= 0 AND "includedPointCount" >= 0 AND
    "billablePointCount" >= 0 AND "billablePointCount" <= "requestedPointCount"
  ),
  ADD CONSTRAINT "energy_analysis_run_price_check" CHECK (
    "pricePerExtraPointMinor" >= 0 AND "proPriceMinor" >= 0 AND
    "proPriceMinor" = "billablePointCount" * "pricePerExtraPointMinor"
  ),
  ADD CONSTRAINT "energy_analysis_run_dates_check" CHECK (
    "dataFrom" IS NULL OR "dataTo" IS NULL OR "dataFrom" < "dataTo"
  );

ALTER TABLE "general"."energy_analysis_scenario"
  ADD CONSTRAINT "energy_analysis_scenario_hardware_check" CHECK (
    "batteryCapacityKwh" >= 0 AND "pvCapacityKwp" >= 0 AND
    ("maxGridInputKw" IS NULL OR "maxGridInputKw" >= 0) AND
    ("maxGridOutputKw" IS NULL OR "maxGridOutputKw" >= 0)
  ),
  ADD CONSTRAINT "energy_analysis_scenario_flows_check" CHECK (
    ("importedKwh" IS NULL OR "importedKwh" >= 0) AND
    ("exportedKwh" IS NULL OR "exportedKwh" >= 0) AND
    ("chargedKwh" IS NULL OR "chargedKwh" >= 0) AND
    ("dischargedKwh" IS NULL OR "dischargedKwh" >= 0) AND
    ("batteryCycles" IS NULL OR "batteryCycles" >= 0) AND
    ("peakImportKw" IS NULL OR "peakImportKw" >= 0)
  );

-- CreateIndex
CREATE INDEX "energy_analysis_run_userId_status_createdAt_idx" ON "general"."energy_analysis_run"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "energy_analysis_run_energySiteId_status_createdAt_idx" ON "general"."energy_analysis_run"("energySiteId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "energy_analysis_run_energySiteId_inputFingerprint_key" ON "general"."energy_analysis_run"("energySiteId", "inputFingerprint");

-- CreateIndex
CREATE INDEX "energy_analysis_scenario_analysisRunId_status_idx" ON "general"."energy_analysis_scenario"("analysisRunId", "status");

-- CreateIndex
CREATE INDEX "energy_analysis_scenario_priceCurveId_idx" ON "general"."energy_analysis_scenario"("priceCurveId");

-- CreateIndex
CREATE UNIQUE INDEX "energy_analysis_scenario_analysisRunId_scenarioKey_key" ON "general"."energy_analysis_scenario"("analysisRunId", "scenarioKey");

-- CreateIndex
CREATE INDEX "service_offer_analysisRunId_idx" ON "payment"."service_offer"("analysisRunId");

-- AddForeignKey
ALTER TABLE "general"."energy_analysis_run" ADD CONSTRAINT "energy_analysis_run_userId_fkey" FOREIGN KEY ("userId") REFERENCES "general"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "general"."energy_analysis_run" ADD CONSTRAINT "energy_analysis_run_energySiteId_fkey" FOREIGN KEY ("energySiteId") REFERENCES "general"."energy_site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "general"."energy_analysis_scenario" ADD CONSTRAINT "energy_analysis_scenario_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "general"."energy_analysis_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "general"."energy_analysis_scenario" ADD CONSTRAINT "energy_analysis_scenario_priceCurveId_fkey" FOREIGN KEY ("priceCurveId") REFERENCES "general"."energy_price_curve"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment"."service_offer" ADD CONSTRAINT "service_offer_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "general"."energy_analysis_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;
