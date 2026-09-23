-- Discount/free/unlock codes and the door's own guest list, one event each.
--
-- Both are built in Pickle now and pushed to Gather.rsvp once its API
-- exists (docs/gather-rsvp-api.md, sections 5 and 6). `TicketCode.uses` and
-- `DoorListEntry.checkedIn` are written by Gather and the door respectively
-- — always 0 until then. See src/lib/ticket-codes.ts and src/lib/door-list.ts.

-- CreateEnum
CREATE TYPE "TicketCodeKind" AS ENUM ('PERCENT_OFF', 'AMOUNT_OFF', 'FREE', 'UNLOCKS_TIER');

-- CreateEnum
CREATE TYPE "DoorListEntryKind" AS ENUM ('GUEST', 'COMP', 'INDUSTRY', 'ACT');

-- CreateTable
CREATE TABLE "TicketCode" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "TicketCodeKind" NOT NULL,
    "value" DOUBLE PRECISION,
    "tierKey" TEXT,
    "useLimit" INTEGER,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "activeFrom" TIMESTAMP(3),
    "activeTo" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "who" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoorListEntry" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "partySize" INTEGER NOT NULL DEFAULT 1,
    "kind" "DoorListEntryKind" NOT NULL DEFAULT 'GUEST',
    "note" TEXT,
    "addedById" TEXT,
    "who" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedIn" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DoorListEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TicketCode_eventId_code_key" ON "TicketCode"("eventId", "code");

-- CreateIndex
CREATE INDEX "TicketCode_eventId_idx" ON "TicketCode"("eventId");

-- CreateIndex
CREATE INDEX "DoorListEntry_eventId_idx" ON "DoorListEntry"("eventId");

-- AddForeignKey
ALTER TABLE "TicketCode" ADD CONSTRAINT "TicketCode_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketCode" ADD CONSTRAINT "TicketCode_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoorListEntry" ADD CONSTRAINT "DoorListEntry_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoorListEntry" ADD CONSTRAINT "DoorListEntry_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
