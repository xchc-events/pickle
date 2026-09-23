-- Ticket sales by day and tier, read from Gather.rsvp.
--
-- The sales graph on Ticketing draws a cumulative curve per tier, which needs
-- sales broken out by day rather than kept as one running total. `sold` here
-- is that day's tickets for that tier; `Event.sold` stays the current total.
-- See src/lib/gather.ts.

-- CreateTable
CREATE TABLE "TicketSaleDay" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "tier" TEXT NOT NULL,
    "sold" INTEGER NOT NULL,

    CONSTRAINT "TicketSaleDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TicketSaleDay_eventId_day_tier_key" ON "TicketSaleDay"("eventId", "day", "tier");

-- AddForeignKey
ALTER TABLE "TicketSaleDay" ADD CONSTRAINT "TicketSaleDay_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
