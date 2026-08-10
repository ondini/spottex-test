-- CreateEnum
CREATE TYPE "payment"."RecurringRenewalStatus" AS ENUM ('SCHEDULED', 'NOTICE_SENT', 'CHARGE_PENDING', 'RETRY', 'PAID', 'FAILED', 'CANCELED');

-- AlterTable
ALTER TABLE "payment"."payment" ADD COLUMN     "recurringRenewalId" TEXT;

-- AlterTable
ALTER TABLE "payment"."subscription" ADD COLUMN     "energySiteId" INTEGER;

-- CreateTable
CREATE TABLE "payment"."recurring_renewal" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "recurringMandateId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "status" "payment"."RecurringRenewalStatus" NOT NULL DEFAULT 'SCHEDULED',
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CZK',
    "noticeAt" TIMESTAMP(3) NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "noticeSentAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_renewal_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "payment"."recurring_renewal"
  ADD CONSTRAINT "recurring_renewal_amount_check" CHECK ("amountMinor" >= 0 AND "amountMinor" <= 99000),
  ADD CONSTRAINT "recurring_renewal_attempt_check" CHECK ("attemptCount" >= 0 AND "attemptCount" <= 3),
  ADD CONSTRAINT "recurring_renewal_dates_check" CHECK ("noticeAt" <= "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_renewal_subscriptionId_key" ON "payment"."recurring_renewal"("subscriptionId");

-- CreateIndex
CREATE INDEX "recurring_renewal_status_noticeAt_idx" ON "payment"."recurring_renewal"("status", "noticeAt");

-- CreateIndex
CREATE INDEX "recurring_renewal_status_scheduledAt_idx" ON "payment"."recurring_renewal"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "recurring_renewal_recurringMandateId_status_idx" ON "payment"."recurring_renewal"("recurringMandateId", "status");

-- CreateIndex
CREATE INDEX "payment_recurringRenewalId_createdAt_idx" ON "payment"."payment"("recurringRenewalId", "createdAt");

-- CreateIndex
CREATE INDEX "subscription_energySiteId_status_startsAt_idx" ON "payment"."subscription"("energySiteId", "status", "startsAt");

-- AddForeignKey
ALTER TABLE "payment"."payment" ADD CONSTRAINT "payment_recurringRenewalId_fkey" FOREIGN KEY ("recurringRenewalId") REFERENCES "payment"."recurring_renewal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment"."subscription" ADD CONSTRAINT "subscription_energySiteId_fkey" FOREIGN KEY ("energySiteId") REFERENCES "general"."energy_site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment"."recurring_renewal" ADD CONSTRAINT "recurring_renewal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "general"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment"."recurring_renewal" ADD CONSTRAINT "recurring_renewal_recurringMandateId_fkey" FOREIGN KEY ("recurringMandateId") REFERENCES "payment"."recurring_payment_mandate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment"."recurring_renewal" ADD CONSTRAINT "recurring_renewal_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "payment"."subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment"."recurring_renewal" ADD CONSTRAINT "recurring_renewal_productId_fkey" FOREIGN KEY ("productId") REFERENCES "payment"."product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
