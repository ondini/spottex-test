CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM consultation.consultation_slot first_slot
    JOIN consultation.consultation_slot second_slot
      ON first_slot."hostUserId" = second_slot."hostUserId"
     AND first_slot.id < second_slot.id
     AND first_slot.status <> 'CANCELED'
     AND second_slot.status <> 'CANCELED'
     AND first_slot."startUtc" < second_slot."endUtc"
     AND first_slot."endUtc" > second_slot."startUtc"
  ) THEN
    RAISE EXCEPTION 'Cannot enforce consultation slot exclusion: overlapping active slots exist';
  END IF;
END $$;

ALTER TABLE consultation.consultation_slot
  ADD CONSTRAINT consultation_slot_host_no_overlap
  EXCLUDE USING gist (
    "hostUserId" WITH =,
    tsrange("startUtc", "endUtc", '[)') WITH &&
  )
  WHERE (status <> 'CANCELED');
