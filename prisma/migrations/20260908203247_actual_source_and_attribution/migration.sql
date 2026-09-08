-- CreateEnum
CREATE TYPE "ActualSource" AS ENUM ('MANUAL', 'POS');

-- AlterTable
ALTER TABLE "Actual" ADD COLUMN     "reconciledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "reconciledBy" TEXT,
ADD COLUMN     "source" "ActualSource" NOT NULL DEFAULT 'MANUAL';
