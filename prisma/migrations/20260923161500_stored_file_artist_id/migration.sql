-- Riders and stage plots per act.
--
-- Connor, 23 Sep 2026: "The only details we want to see here are tech riders
-- and stage plots. These two want to be per artist." A file scoped to a slot
-- that no longer exists is not a file scoped to anything, so this cascades
-- with the act; a file nobody has attached to an act yet — everything
-- uploaded before this migration — simply has no artistId, and Tech shows it
-- under "unassigned".

-- AlterTable
ALTER TABLE "StoredFile" ADD COLUMN "artistId" TEXT;

-- CreateIndex
CREATE INDEX "StoredFile_artistId_idx" ON "StoredFile"("artistId");

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "EventArtist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
