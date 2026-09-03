-- CreateEnum
CREATE TYPE "DealState" AS ENUM ('SENT', 'AGREED', 'QUERIED');

-- CreateEnum
CREATE TYPE "TechStatus" AS ENUM ('DRAFT', 'CONFIRMED');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "allOut" TEXT,
ADD COLUMN     "dateTbc" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deal" "DealState" NOT NULL DEFAULT 'SENT',
ADD COLUMN     "dealNote" TEXT,
ADD COLUMN     "doors" TEXT,
ADD COLUMN     "techStatus" "TechStatus" NOT NULL DEFAULT 'DRAFT';
