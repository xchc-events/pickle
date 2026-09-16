-- Give every event a status per part, in place of one stage it moved through.
--
-- An event sat at one of eight stages and advanced along them in order. Work
-- on a show does not happen in a line — tickets go up while the artwork is
-- still being signed off, a promoter's tour artwork arrives with the enquiry —
-- so each event now carries a status on each of eight parts. Seven of them are
-- worked out from the records their modules already keep and need no column.
-- The booking is the one moved by hand, and it gets one here.
--
-- `stage` and `stageEnteredAt` stay for one release, read and written by
-- nothing, so this backfill can be checked against them before they go.

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('ENQUIRY', 'NEGOTIATING', 'CONFIRMED');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "bookingStatus" "BookingStatus" NOT NULL DEFAULT 'ENQUIRY',
ADD COLUMN     "bookingStatusSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Event_bookingStatus_idx" ON "Event"("bookingStatus");

-- The first three stages were the booking; every stage after them came after
-- the booking was confirmed.
UPDATE "Event"
SET "bookingStatus" = (CASE
    WHEN "stage" >= 2 THEN 'CONFIRMED'
    WHEN "stage" = 1 THEN 'NEGOTIATING'
    ELSE 'ENQUIRY'
  END)::"BookingStatus";

-- Since when. An event still at one of the booking stages reached its status
-- when it entered that stage. One further along was confirmed before it
-- entered the stage it is at now: the activity line written when it moved to
-- Confirmed says exactly when, and where there is none — seeded events — the
-- stage timestamp is the latest it can have been.
UPDATE "Event" e
SET "bookingStatusSince" = CASE
    WHEN e."stage" <= 2 THEN e."stageEnteredAt"
    ELSE COALESCE(
      (
        SELECT MAX(a."at")
        FROM "Activity" a
        WHERE a."eventId" = e."id" AND a."text" = 'moved this to Confirmed'
      ),
      e."stageEnteredAt"
    )
  END;
