-- CreateEnum
CREATE TYPE "payment"."PaymentChargeKind" AS ENUM ('ONE_OFF', 'MANDATE_FIRST', 'MANDATE_REPEAT');

-- CreateEnum
CREATE TYPE "payment"."RecurringMandateStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "payment"."ServiceOfferStatus" AS ENUM ('DRAFT', 'OFFERED', 'ACCEPTED', 'EXPIRED', 'CANCELED');

-- AlterTable
ALTER TABLE "payment"."payment" ADD COLUMN     "chargeKind" "payment"."PaymentChargeKind" NOT NULL DEFAULT 'ONE_OFF',
ADD COLUMN     "recurringMandateId" TEXT,
ADD COLUMN     "serviceOfferId" TEXT;

-- AlterTable
ALTER TABLE "payment"."subscription" ADD COLUMN     "recurringMandateId" TEXT;

-- CreateTable
CREATE TABLE "payment"."recurring_payment_mandate" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "provider" "payment"."PaymentProvider" NOT NULL,
    "providerParentPaymentId" TEXT NOT NULL,
    "status" "payment"."RecurringMandateStatus" NOT NULL DEFAULT 'PENDING',
    "currency" TEXT NOT NULL DEFAULT 'CZK',
    "maxAmountMinor" INTEGER NOT NULL,
    "renewalPeriodDays" INTEGER NOT NULL DEFAULT 365,
    "noticeDays" INTEGER NOT NULL DEFAULT 14,
    "consentVersion" TEXT NOT NULL,
    "consentTextSha256" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_payment_mandate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment"."service_offer" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "energySiteId" INTEGER NOT NULL,
    "analysisJobId" TEXT,
    "status" "payment"."ServiceOfferStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'CZK',
    "expectedControlSavingsMinor" INTEGER NOT NULL,
    "listPriceMinor" INTEGER NOT NULL DEFAULT 99000,
    "savingsShareBps" INTEGER NOT NULL DEFAULT 2500,
    "discountMinor" INTEGER NOT NULL,
    "finalPriceMinor" INTEGER NOT NULL,
    "methodologyVersion" TEXT NOT NULL,
    "inputFingerprint" TEXT NOT NULL,
    "assumptions" JSONB NOT NULL DEFAULT '{}',
    "validUntil" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_offer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurring_payment_mandate_userId_status_createdAt_idx" ON "payment"."recurring_payment_mandate"("userId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_payment_mandate_provider_providerParentPaymentId_key" ON "payment"."recurring_payment_mandate"("provider", "providerParentPaymentId");

CREATE UNIQUE INDEX "recurring_payment_mandate_one_live_per_user_provider" ON "payment"."recurring_payment_mandate"("userId", "provider") WHERE "status" IN ('PENDING', 'ACTIVE');

-- CreateIndex
CREATE INDEX "service_offer_userId_status_validUntil_idx" ON "payment"."service_offer"("userId", "status", "validUntil");

-- CreateIndex
CREATE INDEX "service_offer_energySiteId_createdAt_idx" ON "payment"."service_offer"("energySiteId", "createdAt");

-- CreateIndex
CREATE INDEX "payment_recurringMandateId_createdAt_idx" ON "payment"."payment"("recurringMandateId", "createdAt");

-- CreateIndex
CREATE INDEX "payment_serviceOfferId_createdAt_idx" ON "payment"."payment"("serviceOfferId", "createdAt");

-- AddForeignKey
ALTER TABLE "payment"."payment" ADD CONSTRAINT "payment_recurringMandateId_fkey" FOREIGN KEY ("recurringMandateId") REFERENCES "payment"."recurring_payment_mandate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment"."payment" ADD CONSTRAINT "payment_serviceOfferId_fkey" FOREIGN KEY ("serviceOfferId") REFERENCES "payment"."service_offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment"."subscription" ADD CONSTRAINT "subscription_recurringMandateId_fkey" FOREIGN KEY ("recurringMandateId") REFERENCES "payment"."recurring_payment_mandate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment"."recurring_payment_mandate" ADD CONSTRAINT "recurring_payment_mandate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "general"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment"."service_offer" ADD CONSTRAINT "service_offer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "general"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment"."service_offer" ADD CONSTRAINT "service_offer_energySiteId_fkey" FOREIGN KEY ("energySiteId") REFERENCES "general"."energy_site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment"."payment" ADD CONSTRAINT "payment_repeat_requires_mandate_check" CHECK ("chargeKind" <> 'MANDATE_REPEAT' OR "recurringMandateId" IS NOT NULL);
ALTER TABLE "payment"."recurring_payment_mandate" ADD CONSTRAINT "recurring_payment_mandate_amount_check" CHECK ("maxAmountMinor" > 0);
ALTER TABLE "payment"."recurring_payment_mandate" ADD CONSTRAINT "recurring_payment_mandate_period_check" CHECK ("renewalPeriodDays" > 0 AND "noticeDays" >= 0 AND "noticeDays" < "renewalPeriodDays");
ALTER TABLE "payment"."recurring_payment_mandate" ADD CONSTRAINT "recurring_payment_mandate_validity_check" CHECK ("validUntil" IS NULL OR "validUntil" > "consentedAt");
ALTER TABLE "payment"."service_offer" ADD CONSTRAINT "service_offer_amounts_check" CHECK ("expectedControlSavingsMinor" >= 0 AND "listPriceMinor" >= 0 AND "savingsShareBps" BETWEEN 0 AND 10000 AND "finalPriceMinor" >= 0 AND "finalPriceMinor" <= "listPriceMinor" AND "discountMinor" = "listPriceMinor" - "finalPriceMinor");
ALTER TABLE "payment"."service_offer" ADD CONSTRAINT "service_offer_validity_check" CHECK ("validUntil" > "createdAt");
