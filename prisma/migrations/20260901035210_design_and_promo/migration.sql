-- CreateEnum
CREATE TYPE "LeadRole" AS ENUM ('TICKETING', 'DESIGN', 'PROMO', 'TECH');

-- CreateEnum
CREATE TYPE "AssetState" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED');

-- CreateTable
CREATE TABLE "EventLead" (
    "eventId" TEXT NOT NULL,
    "role" "LeadRole" NOT NULL,
    "personId" TEXT NOT NULL,

    CONSTRAINT "EventLead_pkey" PRIMARY KEY ("eventId","role")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "state" "AssetState" NOT NULL DEFAULT 'DRAFT',
    "promoterSigned" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelPush" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "live" BOOLEAN NOT NULL DEFAULT false,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "byId" TEXT,
    "at" TIMESTAMP(3),

    CONSTRAINT "ChannelPush_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Beat" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Beat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Asset_eventId_key_key" ON "Asset"("eventId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelPush_eventId_channel_key" ON "ChannelPush"("eventId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "Beat_eventId_key_key" ON "Beat"("eventId", "key");

-- AddForeignKey
ALTER TABLE "EventLead" ADD CONSTRAINT "EventLead_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLead" ADD CONSTRAINT "EventLead_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelPush" ADD CONSTRAINT "ChannelPush_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelPush" ADD CONSTRAINT "ChannelPush_byId_fkey" FOREIGN KEY ("byId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Beat" ADD CONSTRAINT "Beat_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
