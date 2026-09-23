-- A shift is offered before it is confirmed.
--
-- Picking somebody in Roster no longer books the hours on the spot: it
-- offers them the shift. A duty manager can confirm it there and then, or
-- email the offer — a link good for one reply, on the `AccessGrant` pattern
-- (32 random bytes, only the SHA-256 kept). Confirming, however it happens,
-- is what books the hour entry.

-- AlterEnum
ALTER TYPE "ShiftState" ADD VALUE 'OFFERED' BEFORE 'ASSIGNED';

-- CreateEnum
CREATE TYPE "ShiftOfferResponse" AS ENUM ('CONFIRMED', 'DECLINED');

-- CreateTable
CREATE TABLE "ShiftOffer" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "response" "ShiftOfferResponse",

    CONSTRAINT "ShiftOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShiftOffer_tokenHash_key" ON "ShiftOffer"("tokenHash");

-- CreateIndex
CREATE INDEX "ShiftOffer_shiftId_idx" ON "ShiftOffer"("shiftId");

-- CreateIndex
CREATE INDEX "ShiftOffer_personId_idx" ON "ShiftOffer"("personId");

-- CreateIndex
CREATE INDEX "ShiftOffer_expires_idx" ON "ShiftOffer"("expires");

-- AddForeignKey
ALTER TABLE "ShiftOffer" ADD CONSTRAINT "ShiftOffer_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftOffer" ADD CONSTRAINT "ShiftOffer_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
