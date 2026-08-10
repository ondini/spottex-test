ALTER TABLE "general"."energy_site_technical_profile"
  ADD COLUMN "currentSupplierName" TEXT,
  ADD COLUMN "currentProductName" TEXT,
  ADD COLUMN "monthlySupplierFeeCzk" DOUBLE PRECISION;
