ALTER TABLE "general"."energy_invoice_document"
  ADD COLUMN "encryptedContent" BYTEA,
  ADD COLUMN "encryptionVersion" TEXT NOT NULL DEFAULT 'AES_256_GCM_V1';

CREATE TABLE "general"."energy_invoice_extraction" (
  "id" TEXT NOT NULL,
  "invoiceRequestId" TEXT NOT NULL,
  "documentId" TEXT,
  "version" INTEGER NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'MANUAL',
  "schemaVersion" TEXT NOT NULL DEFAULT 'energy-invoice-v1',
  "billingPeriodFrom" TIMESTAMP(3),
  "billingPeriodTo" TIMESTAMP(3),
  "extractedData" JSONB NOT NULL DEFAULT '{}',
  "reviewedByUserId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "energy_invoice_extraction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "energy_invoice_extraction_version_positive" CHECK ("version" > 0),
  CONSTRAINT "energy_invoice_extraction_period_order" CHECK ("billingPeriodFrom" IS NULL OR "billingPeriodTo" IS NULL OR "billingPeriodTo" > "billingPeriodFrom")
);

CREATE UNIQUE INDEX "energy_invoice_extraction_invoiceRequestId_version_key"
  ON "general"."energy_invoice_extraction"("invoiceRequestId", "version");
CREATE INDEX "energy_invoice_extraction_documentId_createdAt_idx"
  ON "general"."energy_invoice_extraction"("documentId", "createdAt");

ALTER TABLE "general"."energy_invoice_extraction"
  ADD CONSTRAINT "energy_invoice_extraction_invoiceRequestId_fkey"
  FOREIGN KEY ("invoiceRequestId") REFERENCES "general"."energy_invoice_request"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "energy_invoice_extraction_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "general"."energy_invoice_document"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "energy_invoice_extraction_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "general"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
