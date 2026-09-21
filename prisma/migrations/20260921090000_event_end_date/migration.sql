-- AlterTable
ALTER TABLE "Event" ADD COLUMN "endDate" TIMESTAMP(3);

-- ---------------------------------------------------------------- backfill ---
--
-- Until now an event had one date, and an "everyone out" time in the small
-- hours was understood to mean the next morning (`timeMinutes` in
-- src/lib/event-record.ts carries anything before 6am past midnight). Write
-- that understanding down for the rows that exist: the next day where everyone
-- is out between midnight and 6am, the same day otherwise. An event with no
-- "everyone out" time has no end yet, and stays null.
UPDATE "Event"
SET "endDate" = CASE
  WHEN "allOut" ~ '^(12|[1-5]):[0-5][0-9]am$' THEN "date" + INTERVAL '1 day'
  ELSE "date"
END
WHERE "allOut" IS NOT NULL;
