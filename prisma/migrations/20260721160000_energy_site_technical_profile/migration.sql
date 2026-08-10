CREATE TYPE "general"."EnergyValueSource" AS ENUM ('SOLAX', 'LEGACY_API', 'EAN_LOOKUP', 'INVOICE', 'USER', 'CATALOG', 'MODEL', 'ADMIN');

CREATE TYPE "general"."EnergyInvoiceRequestStatus" AS ENUM ('REQUESTED', 'RECEIVED', 'PROCESSING', 'NEEDS_INPUT', 'CONFIRMED', 'CANCELED');

CREATE TABLE "general"."energy_site_technical_profile" (
    "id" SERIAL NOT NULL,
    "energySiteId" INTEGER NOT NULL,
    "distributorCode" TEXT,
    "distributionTariffCode" TEXT,
    "phases" INTEGER,
    "mainFuseA" DOUBLE PRECISION,
    "maxGridInputKw" DOUBLE PRECISION,
    "maxGridOutputKw" DOUBLE PRECISION,
    "exportAllowed" BOOLEAN,
    "pvCapacityKwp" DOUBLE PRECISION,
    "batteryCapacityKwh" DOUBLE PRECISION,
    "batteryMaxChargeKw" DOUBLE PRECISION,
    "batteryMaxDischargeKw" DOUBLE PRECISION,
    "batteryMinSocPct" DOUBLE PRECISION,
    "batteryMaxSocPct" DOUBLE PRECISION,
    "batteryRoundtripEfficiencyPct" DOUBLE PRECISION,
    "buyPricingMode" TEXT,
    "sellPricingMode" TEXT,
    "fixedBuyPriceCzkKwh" DOUBLE PRECISION,
    "fixedSellPriceCzkKwh" DOUBLE PRECISION,
    "spotBuyFeeCzkKwh" DOUBLE PRECISION,
    "spotSellFeeCzkKwh" DOUBLE PRECISION,
    "fixedPriceValidUntil" TIMESTAMP(3),
    "hdoStatus" TEXT,
    "analysisConfirmedAt" TIMESTAMP(3),
    "controlConfirmedAt" TIMESTAMP(3),
    "legacySnapshot" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "energy_site_technical_profile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "general"."energy_site_field_evidence" (
    "id" BIGSERIAL NOT NULL,
    "energySiteId" INTEGER NOT NULL,
    "field" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "source" "general"."EnergyValueSource" NOT NULL,
    "sourceReference" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "confirmedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "energy_site_field_evidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "general"."energy_invoice_request" (
    "id" TEXT NOT NULL,
    "energySiteId" INTEGER NOT NULL,
    "referenceCode" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL DEFAULT 'contact@spottex.cz',
    "status" "general"."EnergyInvoiceRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "receivedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "energy_invoice_request_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "energy_site_technical_profile_energySiteId_key" ON "general"."energy_site_technical_profile"("energySiteId");
CREATE INDEX "energy_site_field_evidence_energySiteId_field_observedAt_idx" ON "general"."energy_site_field_evidence"("energySiteId", "field", "observedAt");
CREATE UNIQUE INDEX "energy_invoice_request_referenceCode_key" ON "general"."energy_invoice_request"("referenceCode");
CREATE INDEX "energy_invoice_request_energySiteId_status_createdAt_idx" ON "general"."energy_invoice_request"("energySiteId", "status", "createdAt");

ALTER TABLE "general"."energy_site_technical_profile" ADD CONSTRAINT "energy_site_technical_profile_energySiteId_fkey" FOREIGN KEY ("energySiteId") REFERENCES "general"."energy_site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "general"."energy_site_field_evidence" ADD CONSTRAINT "energy_site_field_evidence_energySiteId_fkey" FOREIGN KEY ("energySiteId") REFERENCES "general"."energy_site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "general"."energy_site_field_evidence" ADD CONSTRAINT "energy_site_field_evidence_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "general"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "general"."energy_invoice_request" ADD CONSTRAINT "energy_invoice_request_energySiteId_fkey" FOREIGN KEY ("energySiteId") REFERENCES "general"."energy_site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
