-- Split the reconciliation of a night into its door half and its bar half.
--
-- The four figures were one all-or-nothing row, written by the event record's
-- form behind the Pipeline permission. The bar manager, who holds the till
-- read, could not enter it. Now the door is counted on the event record and
-- the bar is closed in Bar, each with its own source and attribution.

-- The existing attribution described the whole row. It becomes the door's.
ALTER TABLE "Actual" RENAME COLUMN "source" TO "doorSource";
ALTER TABLE "Actual" RENAME COLUMN "reconciledBy" TO "doorReconciledBy";
ALTER TABLE "Actual" RENAME COLUMN "reconciledAt" TO "doorReconciledAt";

-- A half that is not in yet is null, not zero. Zero is a figure: a bar that
-- took nothing is closed, and the settlement must be able to tell the two
-- apart rather than reading an unclosed bar as an empty one.
ALTER TABLE "Actual"
  ALTER COLUMN "tickets" DROP NOT NULL,
  ALTER COLUMN "tickets" DROP DEFAULT,
  ALTER COLUMN "ticketRev" DROP NOT NULL,
  ALTER COLUMN "ticketRev" DROP DEFAULT,
  ALTER COLUMN "barTake" DROP NOT NULL,
  ALTER COLUMN "barTake" DROP DEFAULT,
  ALTER COLUMN "barProfit" DROP NOT NULL,
  ALTER COLUMN "barProfit" DROP DEFAULT,
  ALTER COLUMN "doorSource" DROP NOT NULL,
  ALTER COLUMN "doorSource" DROP DEFAULT,
  ALTER COLUMN "doorReconciledAt" DROP NOT NULL,
  ALTER COLUMN "doorReconciledAt" DROP DEFAULT;

ALTER TABLE "Actual"
  ADD COLUMN "barSource" "ActualSource",
  ADD COLUMN "barReconciledBy" TEXT,
  ADD COLUMN "barReconciledAt" TIMESTAMP(3);

-- Every row that exists was entered as one act covering both halves, so the
-- bar half carries the same attribution the whole row did. No figure changes.
UPDATE "Actual"
SET "barSource" = "doorSource",
    "barReconciledBy" = "doorReconciledBy",
    "barReconciledAt" = "doorReconciledAt";

-- A half is its two figures together or not at all. A ticket count with no
-- revenue cannot price a ticket; a take with no profit cannot go on the bar
-- margin line. Prisma cannot express a CHECK constraint, so it lives here —
-- and it does not register as drift, for the same reason the partial index in
-- 20260915000000_hold_one_confirmed_per_night does not.
ALTER TABLE "Actual"
  ADD CONSTRAINT "Actual_door_half_whole" CHECK (("tickets" IS NULL) = ("ticketRev" IS NULL));
ALTER TABLE "Actual"
  ADD CONSTRAINT "Actual_bar_half_whole" CHECK (("barTake" IS NULL) = ("barProfit" IS NULL));
