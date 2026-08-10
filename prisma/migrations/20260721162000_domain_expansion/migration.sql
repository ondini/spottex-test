-- CreateEnum
CREATE TYPE "general"."ControlledApplianceType" AS ENUM ('HEAT_PUMP', 'WATER_HEATER', 'EV_CHARGER', 'HVAC', 'POOL', 'OTHER');

-- CreateEnum
CREATE TYPE "general"."ControlledApplianceStatus" AS ENUM ('DECLARED', 'READY', 'CONNECTED', 'DISABLED');

-- CreateEnum
CREATE TYPE "tariff"."FundingProgramKind" AS ENUM ('GRANT', 'LOAN');

-- AlterTable
ALTER TABLE "payment"."payment" ADD COLUMN     "analysisRunId" TEXT;

-- CreateTable
CREATE TABLE "general"."energy_pv_array" (
    "id" SERIAL NOT NULL,
    "energySiteId" INTEGER NOT NULL,
    "inverterId" INTEGER,
    "name" TEXT NOT NULL,
    "panelCount" INTEGER,
    "panelRatedWp" DOUBLE PRECISION,
    "nominalDcCapacityKwp" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "source" "general"."EnergyValueSource" NOT NULL DEFAULT 'USER',
    "sourceReference" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "confirmedByUserId" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "energy_pv_array_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "general"."controlled_appliance" (
    "id" SERIAL NOT NULL,
    "energySiteId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" "general"."ControlledApplianceType" NOT NULL,
    "status" "general"."ControlledApplianceStatus" NOT NULL DEFAULT 'DECLARED',
    "ratedPowerKw" DOUBLE PRECISION,
    "controllable" BOOLEAN NOT NULL DEFAULT false,
    "minRuntimeMinutes" INTEGER,
    "maxRuntimeMinutes" INTEGER,
    "constraints" JSONB NOT NULL DEFAULT '{}',
    "source" "general"."EnergyValueSource" NOT NULL DEFAULT 'USER',
    "sourceReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "controlled_appliance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "general"."energy_invoice_document" (
    "id" TEXT NOT NULL,
    "invoiceRequestId" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "billingPeriodFrom" TIMESTAMP(3),
    "billingPeriodTo" TIMESTAMP(3),
    "extractionVersion" TEXT,
    "extractedData" JSONB NOT NULL DEFAULT '{}',
    "sensitive" BOOLEAN NOT NULL DEFAULT true,
    "retainedUntil" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "energy_invoice_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariff"."funding_program" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "tariff"."FundingProgramKind" NOT NULL,
    "providerName" TEXT NOT NULL,
    "officialUrl" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariff"."funding_program_version" (
    "id" SERIAL NOT NULL,
    "fundingProgramId" INTEGER NOT NULL,
    "sourceDocumentId" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "status" "tariff"."CatalogPublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "territoryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "customerSegments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "supportedTechnologies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minimumAmountCzk" DECIMAL(14,2),
    "maximumAmountCzk" DECIMAL(14,2),
    "subsidyRatePct" DECIMAL(7,4),
    "interestRatePct" DECIMAL(7,4),
    "aprPct" DECIMAL(7,4),
    "feesCzk" DECIMAL(14,2),
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "calculationFormula" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_program_version_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "energy_pv_array_energySiteId_active_idx" ON "general"."energy_pv_array"("energySiteId", "active");

-- CreateIndex
CREATE INDEX "energy_pv_array_inverterId_idx" ON "general"."energy_pv_array"("inverterId");

-- CreateIndex
CREATE INDEX "controlled_appliance_energySiteId_status_idx" ON "general"."controlled_appliance"("energySiteId", "status");

-- CreateIndex
CREATE INDEX "energy_invoice_document_retainedUntil_deletedAt_idx" ON "general"."energy_invoice_document"("retainedUntil", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "energy_invoice_document_invoiceRequestId_contentSha256_key" ON "general"."energy_invoice_document"("invoiceRequestId", "contentSha256");

-- CreateIndex
CREATE UNIQUE INDEX "funding_program_code_key" ON "tariff"."funding_program"("code");

-- CreateIndex
CREATE INDEX "funding_program_kind_active_idx" ON "tariff"."funding_program"("kind", "active");

-- CreateIndex
CREATE INDEX "funding_program_version_status_validFrom_validTo_idx" ON "tariff"."funding_program_version"("status", "validFrom", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "funding_program_version_fundingProgramId_validFrom_key" ON "tariff"."funding_program_version"("fundingProgramId", "validFrom");

-- CreateIndex
CREATE INDEX "payment_analysisRunId_createdAt_idx" ON "payment"."payment"("analysisRunId", "createdAt");

-- AddForeignKey
ALTER TABLE "general"."energy_pv_array" ADD CONSTRAINT "energy_pv_array_energySiteId_fkey" FOREIGN KEY ("energySiteId") REFERENCES "general"."energy_site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "general"."energy_pv_array" ADD CONSTRAINT "energy_pv_array_inverterId_fkey" FOREIGN KEY ("inverterId") REFERENCES "general"."inverter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "general"."energy_pv_array" ADD CONSTRAINT "energy_pv_array_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "general"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "general"."controlled_appliance" ADD CONSTRAINT "controlled_appliance_energySiteId_fkey" FOREIGN KEY ("energySiteId") REFERENCES "general"."energy_site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "general"."energy_invoice_document" ADD CONSTRAINT "energy_invoice_document_invoiceRequestId_fkey" FOREIGN KEY ("invoiceRequestId") REFERENCES "general"."energy_invoice_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariff"."funding_program_version" ADD CONSTRAINT "funding_program_version_fundingProgramId_fkey" FOREIGN KEY ("fundingProgramId") REFERENCES "tariff"."funding_program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariff"."funding_program_version" ADD CONSTRAINT "funding_program_version_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "tariff"."catalog_source_document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment"."payment" ADD CONSTRAINT "payment_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "general"."energy_analysis_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Domain integrity: invalid hardware, document metadata or funding ranges must
-- never reach simulations even when a future importer bypasses the UI.
ALTER TABLE "general"."energy_pv_array"
  ADD CONSTRAINT "energy_pv_array_panel_count_positive" CHECK ("panelCount" IS NULL OR "panelCount" > 0),
  ADD CONSTRAINT "energy_pv_array_panel_power_positive" CHECK ("panelRatedWp" IS NULL OR "panelRatedWp" > 0),
  ADD CONSTRAINT "energy_pv_array_capacity_positive" CHECK ("nominalDcCapacityKwp" IS NULL OR "nominalDcCapacityKwp" > 0);

ALTER TABLE "general"."controlled_appliance"
  ADD CONSTRAINT "controlled_appliance_power_nonnegative" CHECK ("ratedPowerKw" IS NULL OR "ratedPowerKw" >= 0),
  ADD CONSTRAINT "controlled_appliance_runtime_positive" CHECK (("minRuntimeMinutes" IS NULL OR "minRuntimeMinutes" > 0) AND ("maxRuntimeMinutes" IS NULL OR "maxRuntimeMinutes" > 0)),
  ADD CONSTRAINT "controlled_appliance_runtime_order" CHECK ("minRuntimeMinutes" IS NULL OR "maxRuntimeMinutes" IS NULL OR "maxRuntimeMinutes" >= "minRuntimeMinutes");

ALTER TABLE "general"."energy_invoice_document"
  ADD CONSTRAINT "energy_invoice_document_size_positive" CHECK ("sizeBytes" > 0),
  ADD CONSTRAINT "energy_invoice_document_sha256" CHECK ("contentSha256" ~ '^[0-9a-fA-F]{64}$'),
  ADD CONSTRAINT "energy_invoice_document_period_order" CHECK ("billingPeriodFrom" IS NULL OR "billingPeriodTo" IS NULL OR "billingPeriodTo" > "billingPeriodFrom");

ALTER TABLE "tariff"."funding_program_version"
  ADD CONSTRAINT "funding_program_version_validity" CHECK ("validTo" IS NULL OR "validTo" > "validFrom"),
  ADD CONSTRAINT "funding_program_version_amounts" CHECK (("minimumAmountCzk" IS NULL OR "minimumAmountCzk" >= 0) AND ("maximumAmountCzk" IS NULL OR "maximumAmountCzk" >= 0) AND ("minimumAmountCzk" IS NULL OR "maximumAmountCzk" IS NULL OR "maximumAmountCzk" >= "minimumAmountCzk")),
  ADD CONSTRAINT "funding_program_version_subsidy_rate" CHECK ("subsidyRatePct" IS NULL OR ("subsidyRatePct" >= 0 AND "subsidyRatePct" <= 100)),
  ADD CONSTRAINT "funding_program_version_interest_rate" CHECK ("interestRatePct" IS NULL OR ("interestRatePct" >= -10 AND "interestRatePct" <= 100)),
  ADD CONSTRAINT "funding_program_version_apr" CHECK ("aprPct" IS NULL OR ("aprPct" >= -10 AND "aprPct" <= 200)),
  ADD CONSTRAINT "funding_program_version_fees" CHECK ("feesCzk" IS NULL OR "feesCzk" >= 0);
