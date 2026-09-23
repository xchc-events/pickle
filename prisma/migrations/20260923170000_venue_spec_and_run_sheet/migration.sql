-- The venue spec becomes something sent, not something uploaded, and a tech
-- run sheet.
--
-- Connor, 23 Sep 2026: "It'd be better to have a more full-featured option
-- where you can select which components of a venue spec sheet you're
-- sending out, as not all of them are relevant to all people. It doesn't
-- make sense that it says 'venue spec sent' and then 'add it yourself',
-- because this will only be uploading on our end, whereas we want it to be
-- emailed out." · "A section here which allows you to fill in a run sheet,
-- like a tech run sheet, would be really helpful. And then sending that to
-- the promoter."
--
-- VenueSpecComponent is a house table, edited in Admin. VenueSpecSend and
-- RunSheetSend each keep the text they actually sent, verbatim, rather than
-- re-assembling it later from rows that may since have changed — the same
-- reason an invoice does not recompute itself when a price changes.

-- CreateTable
CREATE TABLE "VenueSpecComponent" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenueSpecComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueSpecSend" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "componentKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "payeeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "text" TEXT NOT NULL,
    "sentById" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VenueSpecSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunSheetItem" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "time" TEXT,
    "item" TEXT NOT NULL,
    "who" TEXT,
    "note" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RunSheetItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunSheetSend" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "payeeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "text" TEXT NOT NULL,
    "sentById" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunSheetSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VenueSpecComponent_key_key" ON "VenueSpecComponent"("key");

-- CreateIndex
CREATE INDEX "VenueSpecComponent_order_idx" ON "VenueSpecComponent"("order");

-- CreateIndex
CREATE INDEX "VenueSpecSend_eventId_sentAt_idx" ON "VenueSpecSend"("eventId", "sentAt");

-- CreateIndex
CREATE INDEX "RunSheetItem_eventId_order_idx" ON "RunSheetItem"("eventId", "order");

-- CreateIndex
CREATE INDEX "RunSheetSend_eventId_sentAt_idx" ON "RunSheetSend"("eventId", "sentAt");

-- AddForeignKey
ALTER TABLE "VenueSpecSend" ADD CONSTRAINT "VenueSpecSend_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueSpecSend" ADD CONSTRAINT "VenueSpecSend_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunSheetItem" ADD CONSTRAINT "RunSheetItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunSheetSend" ADD CONSTRAINT "RunSheetSend_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunSheetSend" ADD CONSTRAINT "RunSheetSend_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
