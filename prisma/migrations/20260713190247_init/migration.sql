-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "analytics";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "auth";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "consultation";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "content";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "general";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "jobs";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "payment";

-- CreateEnum
CREATE TYPE "general"."UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "general"."UserStatus" AS ENUM ('ACTIVE', 'DISABLED', 'PENDING_VERIFICATION');

-- CreateEnum
CREATE TYPE "general"."EnergyProvider" AS ENUM ('LEGACY_SPOTTEX', 'GRIDLINK', 'DEMO');

-- CreateEnum
CREATE TYPE "general"."ConnectionStatus" AS ENUM ('CONNECTED', 'ACTION_REQUIRED', 'DISCONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "general"."EnergySiteStatus" AS ENUM ('ONLINE', 'OFFLINE', 'ONBOARDING', 'ERROR');

-- CreateEnum
CREATE TYPE "general"."InverterStatus" AS ENUM ('ONLINE', 'OFFLINE', 'UNKNOWN', 'ERROR');

-- CreateEnum
CREATE TYPE "general"."EnergyIntervalKind" AS ENUM ('PRODUCTION', 'CONSUMPTION', 'BATTERY', 'GRID_IMPORT', 'GRID_EXPORT');

-- CreateEnum
CREATE TYPE "general"."CommandStatus" AS ENUM ('PENDING', 'SENT', 'ACKNOWLEDGED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "payment"."ProductType" AS ENUM ('SUBSCRIPTION', 'ONE_TIME');

-- CreateEnum
CREATE TYPE "payment"."CartStatus" AS ENUM ('OPEN', 'CHECKOUT', 'PAID', 'ABANDONED', 'CANCELED');

-- CreateEnum
CREATE TYPE "payment"."PaymentProvider" AS ENUM ('MOCK', 'GOPAY', 'BANK_TRANSFER', 'MANUAL');

-- CreateEnum
CREATE TYPE "payment"."PaymentStatus" AS ENUM ('CREATED', 'PENDING', 'PAID', 'FAILED', 'CANCELED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "payment"."SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIAL', 'PAST_DUE', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "payment"."SubscriptionSource" AS ENUM ('PAID', 'PROMO', 'MANUAL');

-- CreateEnum
CREATE TYPE "payment"."InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'CANCELED');

-- CreateEnum
CREATE TYPE "analytics"."ConsentCategory" AS ENUM ('ANALYTICS', 'MARKETING');

-- CreateEnum
CREATE TYPE "consultation"."ConsultationSlotStatus" AS ENUM ('OPEN', 'HELD', 'BOOKED', 'BLOCKED', 'CANCELED');

-- CreateEnum
CREATE TYPE "consultation"."ConsultationBookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELED', 'EXPIRED', 'COMPLETED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "jobs"."JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateTable
CREATE TABLE "general"."users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "role" "general"."UserRole" NOT NULL DEFAULT 'USER',
    "status" "general"."UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "emailVerifiedAt" TIMESTAMP(3),
    "avatarUrl" TEXT,
    "street" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'CZ',
    "companyName" TEXT,
    "companyIdNumber" TEXT,
    "vatId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."email_verification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."password_reset" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "general"."energy_connection" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "provider" "general"."EnergyProvider" NOT NULL,
    "externalAccountId" TEXT,
    "encryptedAccessToken" TEXT,
    "encryptedRefreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "status" "general"."ConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "lastError" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "energy_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "general"."energy_site" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "provider" "general"."EnergyProvider" NOT NULL,
    "externalSiteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "general"."EnergySiteStatus" NOT NULL DEFAULT 'ONBOARDING',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Prague',
    "ean" TEXT,
    "address" TEXT,
    "optimizationOn" BOOLEAN NOT NULL DEFAULT false,
    "requiredInfo" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "energy_site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "general"."inverter" (
    "id" SERIAL NOT NULL,
    "energySiteId" INTEGER NOT NULL,
    "provider" "general"."EnergyProvider" NOT NULL,
    "externalDeviceId" TEXT NOT NULL,
    "name" TEXT,
    "manufacturer" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "status" "general"."InverterStatus" NOT NULL DEFAULT 'UNKNOWN',
    "lastSeenAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inverter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "general"."energy_measurement" (
    "id" BIGSERIAL NOT NULL,
    "inverterId" INTEGER NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "productionKw" DOUBLE PRECISION,
    "consumptionKw" DOUBLE PRECISION,
    "gridKw" DOUBLE PRECISION,
    "batteryKw" DOUBLE PRECISION,
    "batterySocPct" DOUBLE PRECISION,
    "buyPriceCzk" DOUBLE PRECISION,
    "sellPriceCzk" DOUBLE PRECISION,
    "raw" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "energy_measurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "general"."energy_interval" (
    "id" BIGSERIAL NOT NULL,
    "inverterId" INTEGER NOT NULL,
    "kind" "general"."EnergyIntervalKind" NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "kwh" DOUBLE PRECISION NOT NULL,
    "predicted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "energy_interval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "general"."inverter_schedule" (
    "id" BIGSERIAL NOT NULL,
    "inverterId" INTEGER NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "mode" TEXT NOT NULL,
    "sellKw" DOUBLE PRECISION,
    "buyKw" DOUBLE PRECISION,
    "batteryKw" DOUBLE PRECISION,
    "targetSoc" DOUBLE PRECISION,
    "costCzk" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'ENERGY_API',

    CONSTRAINT "inverter_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "general"."inverter_command" (
    "id" TEXT NOT NULL,
    "inverterId" INTEGER NOT NULL,
    "requestedById" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "general"."CommandStatus" NOT NULL DEFAULT 'PENDING',
    "response" JSONB,
    "error" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "inverter_command_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment"."product" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "payment"."ProductType" NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CZK',
    "billingPeriodDays" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment"."cart" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "status" "payment"."CartStatus" NOT NULL DEFAULT 'OPEN',
    "currency" TEXT NOT NULL DEFAULT 'CZK',
    "totalMinor" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment"."cart_item" (
    "id" SERIAL NOT NULL,
    "cartId" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceMinor" INTEGER NOT NULL,
    "productName" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "cart_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment"."payment" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "cartId" TEXT,
    "provider" "payment"."PaymentProvider" NOT NULL,
    "providerPaymentId" TEXT,
    "status" "payment"."PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CZK',
    "idempotencyKey" TEXT NOT NULL,
    "providerPayload" JSONB NOT NULL DEFAULT '{}',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment"."subscription" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "paymentId" TEXT,
    "status" "payment"."SubscriptionStatus" NOT NULL,
    "source" "payment"."SubscriptionSource" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "activatedByAdminId" INTEGER,
    "activationReason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment"."invoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "paymentId" TEXT,
    "status" "payment"."InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "currency" TEXT NOT NULL DEFAULT 'CZK',
    "subtotalMinor" INTEGER NOT NULL,
    "vatMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL,
    "sellerSnapshot" JSONB NOT NULL,
    "customerSnapshot" JSONB NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment"."invoice_item" (
    "id" SERIAL NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceMinor" INTEGER NOT NULL,
    "vatRate" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL,

    CONSTRAINT "invoice_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment"."invoice_counter" (
    "year" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_counter_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "content"."founder" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "bio" TEXT,
    "photoUrl" TEXT,
    "linkedInUrl" TEXT,
    "email" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "founder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content"."reference_project" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "url" TEXT,
    "location" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reference_project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content"."site_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "metaPixelId" TEXT,
    "metaPixelEnabled" BOOLEAN NOT NULL DEFAULT false,
    "analyticsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "consultationLead" TEXT,
    "contactEmail" TEXT,
    "sellerCompanyName" TEXT NOT NULL DEFAULT 'Spottex Energy s.r.o.',
    "sellerCompanyId" TEXT,
    "sellerVatId" TEXT,
    "sellerAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content"."blog_post" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT,
    "content" TEXT NOT NULL,
    "coverUrl" TEXT,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "authorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blog_post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics"."consent_record" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" INTEGER,
    "category" "analytics"."ConsentCategory" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "version" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics"."analytics_event" (
    "id" BIGSERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "path" TEXT,
    "sessionId" TEXT NOT NULL,
    "userId" INTEGER,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation"."consultation_slot" (
    "id" SERIAL NOT NULL,
    "hostUserId" INTEGER NOT NULL,
    "startUtc" TIMESTAMP(3) NOT NULL,
    "endUtc" TIMESTAMP(3) NOT NULL,
    "status" "consultation"."ConsultationSlotStatus" NOT NULL DEFAULT 'OPEN',
    "holdExpiresAt" TIMESTAMP(3),
    "googleEventId" TEXT,
    "meetUrl" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Prague',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultation_slot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation"."consultation_booking" (
    "id" SERIAL NOT NULL,
    "slotId" INTEGER NOT NULL,
    "guestName" TEXT,
    "guestEmail" TEXT NOT NULL,
    "guestPhone" TEXT,
    "note" TEXT,
    "status" "consultation"."ConsultationBookingStatus" NOT NULL DEFAULT 'PENDING',
    "manageTokenHash" TEXT NOT NULL,
    "verifyTokenHash" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "consentAt" TIMESTAMP(3),
    "clientIpHash" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultation_booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation"."consultation_host_calendar" (
    "id" SERIAL NOT NULL,
    "hostUserId" INTEGER NOT NULL,
    "googleEmail" TEXT,
    "encryptedAccessToken" TEXT,
    "encryptedRefreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "maskCalendarIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "targetCalendarId" TEXT,
    "autoMeet" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Prague',
    "targetSlotsPerWeek" INTEGER NOT NULL DEFAULT 10,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultation_host_calendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs"."scheduled_job" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "jobs"."JobStatus" NOT NULL DEFAULT 'PENDING',
    "runAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs"."email_outbox" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "textBody" TEXT NOT NULL,
    "htmlBody" TEXT,
    "status" "jobs"."JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sendAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs"."audit_log" (
    "id" BIGSERIAL NOT NULL,
    "actorUserId" INTEGER,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "general"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokenHash_key" ON "auth"."email_verification"("tokenHash");

-- CreateIndex
CREATE INDEX "email_verification_userId_expiresAt_idx" ON "auth"."email_verification"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokenHash_key" ON "auth"."password_reset"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_userId_expiresAt_idx" ON "auth"."password_reset"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "energy_connection_userId_provider_key" ON "general"."energy_connection"("userId", "provider");

-- CreateIndex
CREATE INDEX "energy_site_userId_status_idx" ON "general"."energy_site"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "energy_site_provider_externalSiteId_key" ON "general"."energy_site"("provider", "externalSiteId");

-- CreateIndex
CREATE INDEX "inverter_energySiteId_status_idx" ON "general"."inverter"("energySiteId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "inverter_provider_externalDeviceId_key" ON "general"."inverter"("provider", "externalDeviceId");

-- CreateIndex
CREATE INDEX "energy_measurement_measuredAt_idx" ON "general"."energy_measurement"("measuredAt");

-- CreateIndex
CREATE UNIQUE INDEX "energy_measurement_inverterId_measuredAt_key" ON "general"."energy_measurement"("inverterId", "measuredAt");

-- CreateIndex
CREATE INDEX "energy_interval_inverterId_startAt_idx" ON "general"."energy_interval"("inverterId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "energy_interval_inverterId_kind_startAt_key" ON "general"."energy_interval"("inverterId", "kind", "startAt");

-- CreateIndex
CREATE INDEX "inverter_schedule_inverterId_startAt_idx" ON "general"."inverter_schedule"("inverterId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "inverter_schedule_inverterId_startAt_mode_key" ON "general"."inverter_schedule"("inverterId", "startAt", "mode");

-- CreateIndex
CREATE UNIQUE INDEX "inverter_command_idempotencyKey_key" ON "general"."inverter_command"("idempotencyKey");

-- CreateIndex
CREATE INDEX "inverter_command_inverterId_requestedAt_idx" ON "general"."inverter_command"("inverterId", "requestedAt");

-- CreateIndex
CREATE INDEX "inverter_command_status_requestedAt_idx" ON "general"."inverter_command"("status", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "product_code_key" ON "payment"."product"("code");

-- CreateIndex
CREATE INDEX "cart_userId_status_idx" ON "payment"."cart"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cart_item_cartId_productId_key" ON "payment"."cart_item"("cartId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_idempotencyKey_key" ON "payment"."payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payment_userId_createdAt_idx" ON "payment"."payment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "payment_provider_providerPaymentId_idx" ON "payment"."payment"("provider", "providerPaymentId");

-- CreateIndex
CREATE INDEX "subscription_userId_status_startsAt_idx" ON "payment"."subscription"("userId", "status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_number_key" ON "payment"."invoice"("number");

-- CreateIndex
CREATE INDEX "invoice_userId_issuedAt_idx" ON "payment"."invoice"("userId", "issuedAt");

-- CreateIndex
CREATE INDEX "founder_published_sortOrder_idx" ON "content"."founder"("published", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "reference_project_slug_key" ON "content"."reference_project"("slug");

-- CreateIndex
CREATE INDEX "reference_project_published_sortOrder_idx" ON "content"."reference_project"("published", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "blog_post_slug_key" ON "content"."blog_post"("slug");

-- CreateIndex
CREATE INDEX "blog_post_published_publishedAt_idx" ON "content"."blog_post"("published", "publishedAt");

-- CreateIndex
CREATE INDEX "consent_record_sessionId_createdAt_idx" ON "analytics"."consent_record"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "analytics_event_type_occurredAt_idx" ON "analytics"."analytics_event"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "analytics_event_sessionId_occurredAt_idx" ON "analytics"."analytics_event"("sessionId", "occurredAt");

-- CreateIndex
CREATE INDEX "analytics_event_userId_occurredAt_idx" ON "analytics"."analytics_event"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "consultation_slot_hostUserId_status_startUtc_idx" ON "consultation"."consultation_slot"("hostUserId", "status", "startUtc");

-- CreateIndex
CREATE INDEX "consultation_slot_status_startUtc_idx" ON "consultation"."consultation_slot"("status", "startUtc");

-- CreateIndex
CREATE UNIQUE INDEX "consultation_slot_hostUserId_startUtc_key" ON "consultation"."consultation_slot"("hostUserId", "startUtc");

-- CreateIndex
CREATE UNIQUE INDEX "consultation_booking_manageTokenHash_key" ON "consultation"."consultation_booking"("manageTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "consultation_booking_verifyTokenHash_key" ON "consultation"."consultation_booking"("verifyTokenHash");

-- CreateIndex
CREATE INDEX "consultation_booking_slotId_status_idx" ON "consultation"."consultation_booking"("slotId", "status");

-- CreateIndex
CREATE INDEX "consultation_booking_guestEmail_createdAt_idx" ON "consultation"."consultation_booking"("guestEmail", "createdAt");

-- CreateIndex
CREATE INDEX "consultation_booking_status_createdAt_idx" ON "consultation"."consultation_booking"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "consultation_host_calendar_hostUserId_key" ON "consultation"."consultation_host_calendar"("hostUserId");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_job_idempotencyKey_key" ON "jobs"."scheduled_job"("idempotencyKey");

-- CreateIndex
CREATE INDEX "scheduled_job_status_runAt_idx" ON "jobs"."scheduled_job"("status", "runAt");

-- CreateIndex
CREATE UNIQUE INDEX "email_outbox_idempotencyKey_key" ON "jobs"."email_outbox"("idempotencyKey");

-- CreateIndex
CREATE INDEX "email_outbox_status_sendAt_idx" ON "jobs"."email_outbox"("status", "sendAt");

-- CreateIndex
CREATE INDEX "audit_log_entityType_entityId_createdAt_idx" ON "jobs"."audit_log"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_actorUserId_createdAt_idx" ON "jobs"."audit_log"("actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "auth"."email_verification" ADD CONSTRAINT "email_verification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "general"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth"."password_reset" ADD CONSTRAINT "password_reset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "general"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "general"."energy_connection" ADD CONSTRAINT "energy_connection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "general"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "general"."energy_site" ADD CONSTRAINT "energy_site_userId_fkey" FOREIGN KEY ("userId") REFERENCES "general"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "general"."inverter" ADD CONSTRAINT "inverter_energySiteId_fkey" FOREIGN KEY ("energySiteId") REFERENCES "general"."energy_site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "general"."energy_measurement" ADD CONSTRAINT "energy_measurement_inverterId_fkey" FOREIGN KEY ("inverterId") REFERENCES "general"."inverter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "general"."energy_interval" ADD CONSTRAINT "energy_interval_inverterId_fkey" FOREIGN KEY ("inverterId") REFERENCES "general"."inverter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "general"."inverter_schedule" ADD CONSTRAINT "inverter_schedule_inverterId_fkey" FOREIGN KEY ("inverterId") REFERENCES "general"."inverter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "general"."inverter_command" ADD CONSTRAINT "inverter_command_inverterId_fkey" FOREIGN KEY ("inverterId") REFERENCES "general"."inverter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment"."cart" ADD CONSTRAINT "cart_userId_fkey" FOREIGN KEY ("userId") REFERENCES "general"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment"."cart_item" ADD CONSTRAINT "cart_item_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "payment"."cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment"."cart_item" ADD CONSTRAINT "cart_item_productId_fkey" FOREIGN KEY ("productId") REFERENCES "payment"."product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment"."payment" ADD CONSTRAINT "payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "general"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment"."payment" ADD CONSTRAINT "payment_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "payment"."cart"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment"."subscription" ADD CONSTRAINT "subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "general"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment"."subscription" ADD CONSTRAINT "subscription_productId_fkey" FOREIGN KEY ("productId") REFERENCES "payment"."product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment"."subscription" ADD CONSTRAINT "subscription_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"."payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment"."subscription" ADD CONSTRAINT "subscription_activatedByAdminId_fkey" FOREIGN KEY ("activatedByAdminId") REFERENCES "general"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment"."invoice" ADD CONSTRAINT "invoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "general"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment"."invoice" ADD CONSTRAINT "invoice_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"."payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment"."invoice_item" ADD CONSTRAINT "invoice_item_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "payment"."invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content"."blog_post" ADD CONSTRAINT "blog_post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "general"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics"."analytics_event" ADD CONSTRAINT "analytics_event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "general"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation"."consultation_slot" ADD CONSTRAINT "consultation_slot_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "general"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation"."consultation_booking" ADD CONSTRAINT "consultation_booking_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "consultation"."consultation_slot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation"."consultation_host_calendar" ADD CONSTRAINT "consultation_host_calendar_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "general"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs"."audit_log" ADD CONSTRAINT "audit_log_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "general"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
