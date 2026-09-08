-- CreateEnum
CREATE TYPE "HoldState" AS ENUM ('HELD', 'RELEASED', 'CONFIRMED');

-- CreateTable
CREATE TABLE "Hold" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "rank" INTEGER NOT NULL,
    "state" "HoldState" NOT NULL DEFAULT 'HELD',
    "challengedByEventId" TEXT,
    "challengedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Hold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Hold_spaceId_date_idx" ON "Hold"("spaceId", "date");

-- CreateIndex
CREATE INDEX "Hold_eventId_idx" ON "Hold"("eventId");

-- AddForeignKey
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
