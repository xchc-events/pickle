-- CreateEnum
CREATE TYPE "PayeeKind" AS ENUM ('ARTIST', 'PROMOTER');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('RIDER_HOSPITALITY', 'RIDER_TECH', 'STAGE_PLOT', 'TECH_SPEC', 'PRESS_SHOT', 'BIO', 'EPK', 'ARTWORK', 'BRAND', 'OTHER');

-- CreateEnum
CREATE TYPE "ScanState" AS ENUM ('PENDING', 'CLEAN', 'BLOCKED');

-- CreateEnum
CREATE TYPE "GrantScope" AS ENUM ('PAYMENT_DETAILS', 'RIDER', 'BOTH');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "promoterId" TEXT;

-- AlterTable
ALTER TABLE "EventArtist" DROP COLUMN "files",
ADD COLUMN     "payeeId" TEXT;

-- CreateTable
CREATE TABLE "Payee" (
    "id" TEXT NOT NULL,
    "kind" "PayeeKind" NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "country" TEXT NOT NULL DEFAULT 'NZ',
    "bankEnc" BYTEA,
    "bankTail" TEXT,
    "bankName" TEXT,
    "irdEnc" BYTEA,
    "irdTail" TEXT,
    "gstReg" BOOLEAN NOT NULL DEFAULT false,
    "gstNumber" TEXT,
    "nrctRate" DOUBLE PRECISION,
    "nrctExempt" BOOLEAN NOT NULL DEFAULT false,
    "detailsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "kind" "FileKind" NOT NULL,
    "scan" "ScanState" NOT NULL DEFAULT 'PENDING',
    "eventId" TEXT,
    "payeeId" TEXT,
    "assetId" TEXT,
    "uploadedById" TEXT,
    "grantId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "current" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessGrant" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scope" "GrantScope" NOT NULL,
    "payeeId" TEXT NOT NULL,
    "eventId" TEXT,
    "expires" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payee_kind_name_idx" ON "Payee"("kind", "name");

-- CreateIndex
CREATE UNIQUE INDEX "StoredFile_key_key" ON "StoredFile"("key");

-- CreateIndex
CREATE INDEX "StoredFile_eventId_kind_idx" ON "StoredFile"("eventId", "kind");

-- CreateIndex
CREATE INDEX "StoredFile_payeeId_kind_idx" ON "StoredFile"("payeeId", "kind");

-- CreateIndex
CREATE INDEX "StoredFile_assetId_idx" ON "StoredFile"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessGrant_tokenHash_key" ON "AccessGrant"("tokenHash");

-- CreateIndex
CREATE INDEX "AccessGrant_payeeId_idx" ON "AccessGrant"("payeeId");

-- CreateIndex
CREATE INDEX "AccessGrant_expires_idx" ON "AccessGrant"("expires");

-- CreateIndex
CREATE INDEX "Event_promoterId_idx" ON "Event"("promoterId");

-- CreateIndex
CREATE INDEX "EventArtist_payeeId_idx" ON "EventArtist"("payeeId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_promoterId_fkey" FOREIGN KEY ("promoterId") REFERENCES "Payee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventArtist" ADD CONSTRAINT "EventArtist_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "Payee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "Payee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "AccessGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "Payee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

