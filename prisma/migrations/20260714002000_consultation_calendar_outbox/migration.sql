ALTER TABLE "consultation"."consultation_slot"
  ADD COLUMN "googleCalendarId" TEXT;

ALTER TABLE "consultation"."consultation_booking"
  ADD COLUMN "calendarRevision" INTEGER NOT NULL DEFAULT 0;
