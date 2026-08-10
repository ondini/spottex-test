-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "tariff";

-- CreateEnum
CREATE TYPE "tariff"."CatalogPublicationStatus" AS ENUM ('DRAFT', 'VALIDATED', 'PUBLISHED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "tariff"."EnergyPricingMode" AS ENUM ('FIX', 'SPOT', 'TIME_CURVE');

-- CreateEnum
CREATE TYPE "general"."HdoCalendarSource" AS ENUM ('DISTRIBUTOR', 'USER', 'INVOICE', 'MODEL');

-- CreateEnum
CREATE TYPE "general"."EnergyPriceCurveStatus" AS ENUM ('DRAFT', 'READY', 'INVALID', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "tariff"."energy_company" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "websiteUrl" TEXT,
    "roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "energy_company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariff"."catalog_source_document" (
    "id" TEXT NOT NULL,
    "companyId" INTEGER,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "status" "tariff"."CatalogPublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "rawText" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_source_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariff"."energy_product" (
    "id" SERIAL NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerSegment" TEXT NOT NULL DEFAULT 'HOUSEHOLD',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "energy_product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariff"."energy_product_version" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "sourceDocumentId" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "status" "tariff"."CatalogPublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'CZK',
    "vatIncluded" BOOLEAN NOT NULL DEFAULT true,
    "buyMode" "tariff"."EnergyPricingMode" NOT NULL,
    "sellMode" "tariff"."EnergyPricingMode" NOT NULL,
    "monthlyFeeCzk" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "fixedBuyVtCzkKwh" DECIMAL(14,6),
    "fixedBuyNtCzkKwh" DECIMAL(14,6),
    "fixedSellVtCzkKwh" DECIMAL(14,6),
    "fixedSellNtCzkKwh" DECIMAL(14,6),
    "spotBuyFeeCzkKwh" DECIMAL(14,6),
    "spotSellFeeCzkKwh" DECIMAL(14,6),
    "formula" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "energy_product_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariff"."distribution_tariff" (
    "id" SERIAL NOT NULL,
    "distributorId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerSegment" TEXT NOT NULL DEFAULT 'HOUSEHOLD',
    "eligibilityNote" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "distribution_tariff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariff"."distribution_tariff_version" (
    "id" SERIAL NOT NULL,
    "distributionTariffId" INTEGER NOT NULL,
    "sourceDocumentId" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "status" "tariff"."CatalogPublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'CZK',
    "vatIncluded" BOOLEAN NOT NULL DEFAULT true,
    "distributionVtCzkKwh" DECIMAL(14,6) NOT NULL,
    "distributionNtCzkKwh" DECIMAL(14,6) NOT NULL,
    "systemServicesCzkKwh" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "electricityTaxCzkKwh" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "pozeCzkKwh" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "monthlyMeterFeeCzk" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "breakerFees" JSONB NOT NULL DEFAULT '{}',
    "eligibility" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "distribution_tariff_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariff"."market_price_series" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CZK',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Prague',
    "resolutionMinutes" INTEGER NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "sourceUrl" TEXT,
    "sourceSha256" TEXT,
    "status" "tariff"."CatalogPublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_price_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariff"."market_price_point" (
    "id" BIGSERIAL NOT NULL,
    "seriesId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "priceCzkMwh" DECIMAL(16,6) NOT NULL,

    CONSTRAINT "market_price_point_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "general"."energy_hdo_calendar" (
    "id" TEXT NOT NULL,
    "energySiteId" INTEGER NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "source" "general"."HdoCalendarSource" NOT NULL,
    "exact" BOOLEAN NOT NULL DEFAULT false,
    "confidencePct" DOUBLE PRECISION,
    "sourceReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "energy_hdo_calendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "general"."energy_hdo_interval" (
    "id" BIGSERIAL NOT NULL,
    "calendarId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "lowTariff" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "energy_hdo_interval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "general"."energy_price_curve" (
    "id" TEXT NOT NULL,
    "energySiteId" INTEGER,
    "buyProductVersionId" INTEGER,
    "sellProductVersionId" INTEGER,
    "distributionVersionId" INTEGER,
    "marketPriceSeriesId" TEXT,
    "hdoCalendarId" TEXT,
    "fingerprint" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Prague',
    "resolutionMinutes" INTEGER NOT NULL DEFAULT 15,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "monthlyFixedCzk" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "general"."EnergyPriceCurveStatus" NOT NULL DEFAULT 'DRAFT',
    "assumptions" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "energy_price_curve_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "general"."energy_price_curve_point" (
    "id" BIGSERIAL NOT NULL,
    "curveId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "lowTariff" BOOLEAN NOT NULL,
    "commodityBuyCzkKwh" DECIMAL(14,6) NOT NULL,
    "commoditySellCzkKwh" DECIMAL(14,6) NOT NULL,
    "distributionCzkKwh" DECIMAL(14,6) NOT NULL,
    "otherRegulatedCzkKwh" DECIMAL(14,6) NOT NULL,
    "totalBuyCzkKwh" DECIMAL(14,6) NOT NULL,
    "totalSellCzkKwh" DECIMAL(14,6) NOT NULL,

    CONSTRAINT "energy_price_curve_point_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "energy_company_code_key" ON "tariff"."energy_company"("code");

-- CreateIndex
CREATE INDEX "catalog_source_document_kind_status_retrievedAt_idx" ON "tariff"."catalog_source_document"("kind", "status", "retrievedAt");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_source_document_sourceUrl_contentSha256_key" ON "tariff"."catalog_source_document"("sourceUrl", "contentSha256");

-- CreateIndex
CREATE INDEX "energy_product_customerSegment_active_idx" ON "tariff"."energy_product"("customerSegment", "active");

-- CreateIndex
CREATE UNIQUE INDEX "energy_product_supplierId_code_key" ON "tariff"."energy_product"("supplierId", "code");

-- CreateIndex
CREATE INDEX "energy_product_version_status_validFrom_validTo_idx" ON "tariff"."energy_product_version"("status", "validFrom", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "energy_product_version_productId_validFrom_key" ON "tariff"."energy_product_version"("productId", "validFrom");

-- CreateIndex
CREATE INDEX "distribution_tariff_customerSegment_active_idx" ON "tariff"."distribution_tariff"("customerSegment", "active");

-- CreateIndex
CREATE UNIQUE INDEX "distribution_tariff_distributorId_code_customerSegment_key" ON "tariff"."distribution_tariff"("distributorId", "code", "customerSegment");

-- CreateIndex
CREATE INDEX "distribution_tariff_version_status_validFrom_validTo_idx" ON "tariff"."distribution_tariff_version"("status", "validFrom", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "distribution_tariff_version_distributionTariffId_validFrom_key" ON "tariff"."distribution_tariff_version"("distributionTariffId", "validFrom");

-- CreateIndex
CREATE INDEX "market_price_series_market_status_validFrom_idx" ON "tariff"."market_price_series"("market", "status", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "market_price_series_code_validFrom_resolutionMinutes_key" ON "tariff"."market_price_series"("code", "validFrom", "resolutionMinutes");

-- CreateIndex
CREATE INDEX "market_price_point_startAt_idx" ON "tariff"."market_price_point"("startAt");

-- CreateIndex
CREATE UNIQUE INDEX "market_price_point_seriesId_startAt_key" ON "tariff"."market_price_point"("seriesId", "startAt");

-- CreateIndex
CREATE INDEX "energy_hdo_calendar_energySiteId_validFrom_validTo_idx" ON "general"."energy_hdo_calendar"("energySiteId", "validFrom", "validTo");

-- CreateIndex
CREATE INDEX "energy_hdo_interval_startAt_endAt_idx" ON "general"."energy_hdo_interval"("startAt", "endAt");

-- CreateIndex
CREATE UNIQUE INDEX "energy_hdo_interval_calendarId_startAt_key" ON "general"."energy_hdo_interval"("calendarId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "energy_price_curve_fingerprint_key" ON "general"."energy_price_curve"("fingerprint");

-- CreateIndex
CREATE INDEX "energy_price_curve_energySiteId_status_validFrom_idx" ON "general"."energy_price_curve"("energySiteId", "status", "validFrom");

-- CreateIndex
CREATE INDEX "energy_price_curve_buyProductVersionId_sellProductVersionId_idx" ON "general"."energy_price_curve"("buyProductVersionId", "sellProductVersionId", "distributionVersionId");

-- CreateIndex
CREATE INDEX "energy_price_curve_point_startAt_idx" ON "general"."energy_price_curve_point"("startAt");

-- CreateIndex
CREATE UNIQUE INDEX "energy_price_curve_point_curveId_startAt_key" ON "general"."energy_price_curve_point"("curveId", "startAt");

-- AddForeignKey
ALTER TABLE "tariff"."catalog_source_document" ADD CONSTRAINT "catalog_source_document_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "tariff"."energy_company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariff"."energy_product" ADD CONSTRAINT "energy_product_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "tariff"."energy_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariff"."energy_product_version" ADD CONSTRAINT "energy_product_version_productId_fkey" FOREIGN KEY ("productId") REFERENCES "tariff"."energy_product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariff"."energy_product_version" ADD CONSTRAINT "energy_product_version_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "tariff"."catalog_source_document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariff"."distribution_tariff" ADD CONSTRAINT "distribution_tariff_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "tariff"."energy_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariff"."distribution_tariff_version" ADD CONSTRAINT "distribution_tariff_version_distributionTariffId_fkey" FOREIGN KEY ("distributionTariffId") REFERENCES "tariff"."distribution_tariff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariff"."distribution_tariff_version" ADD CONSTRAINT "distribution_tariff_version_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "tariff"."catalog_source_document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariff"."market_price_point" ADD CONSTRAINT "market_price_point_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "tariff"."market_price_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "general"."energy_hdo_calendar" ADD CONSTRAINT "energy_hdo_calendar_energySiteId_fkey" FOREIGN KEY ("energySiteId") REFERENCES "general"."energy_site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "general"."energy_hdo_interval" ADD CONSTRAINT "energy_hdo_interval_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "general"."energy_hdo_calendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "general"."energy_price_curve" ADD CONSTRAINT "energy_price_curve_energySiteId_fkey" FOREIGN KEY ("energySiteId") REFERENCES "general"."energy_site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "general"."energy_price_curve" ADD CONSTRAINT "energy_price_curve_buyProductVersionId_fkey" FOREIGN KEY ("buyProductVersionId") REFERENCES "tariff"."energy_product_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "general"."energy_price_curve" ADD CONSTRAINT "energy_price_curve_sellProductVersionId_fkey" FOREIGN KEY ("sellProductVersionId") REFERENCES "tariff"."energy_product_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "general"."energy_price_curve" ADD CONSTRAINT "energy_price_curve_distributionVersionId_fkey" FOREIGN KEY ("distributionVersionId") REFERENCES "tariff"."distribution_tariff_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "general"."energy_price_curve" ADD CONSTRAINT "energy_price_curve_marketPriceSeriesId_fkey" FOREIGN KEY ("marketPriceSeriesId") REFERENCES "tariff"."market_price_series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "general"."energy_price_curve" ADD CONSTRAINT "energy_price_curve_hdoCalendarId_fkey" FOREIGN KEY ("hdoCalendarId") REFERENCES "general"."energy_hdo_calendar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "general"."energy_price_curve_point" ADD CONSTRAINT "energy_price_curve_point_curveId_fkey" FOREIGN KEY ("curveId") REFERENCES "general"."energy_price_curve"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tariff"."energy_product_version" ADD CONSTRAINT "energy_product_version_validity_check" CHECK ("validTo" IS NULL OR "validTo" > "validFrom");
ALTER TABLE "tariff"."distribution_tariff_version" ADD CONSTRAINT "distribution_tariff_version_validity_check" CHECK ("validTo" IS NULL OR "validTo" > "validFrom");
ALTER TABLE "tariff"."market_price_series" ADD CONSTRAINT "market_price_series_validity_check" CHECK ("validTo" > "validFrom");
ALTER TABLE "tariff"."market_price_series" ADD CONSTRAINT "market_price_series_resolution_check" CHECK ("resolutionMinutes" IN (15, 60));
ALTER TABLE "tariff"."market_price_point" ADD CONSTRAINT "market_price_point_validity_check" CHECK ("endAt" > "startAt");
ALTER TABLE "general"."energy_hdo_calendar" ADD CONSTRAINT "energy_hdo_calendar_validity_check" CHECK ("validTo" > "validFrom");
ALTER TABLE "general"."energy_hdo_calendar" ADD CONSTRAINT "energy_hdo_calendar_confidence_check" CHECK ("confidencePct" IS NULL OR ("confidencePct" >= 0 AND "confidencePct" <= 100));
ALTER TABLE "general"."energy_hdo_interval" ADD CONSTRAINT "energy_hdo_interval_validity_check" CHECK ("endAt" > "startAt");
ALTER TABLE "general"."energy_price_curve" ADD CONSTRAINT "energy_price_curve_validity_check" CHECK ("validTo" > "validFrom");
ALTER TABLE "general"."energy_price_curve" ADD CONSTRAINT "energy_price_curve_resolution_check" CHECK ("resolutionMinutes" IN (15, 60));
ALTER TABLE "general"."energy_price_curve_point" ADD CONSTRAINT "energy_price_curve_point_validity_check" CHECK ("endAt" > "startAt");
