-- AlterTable
ALTER TABLE "HourEntry" ADD COLUMN     "role" TEXT,
ADD COLUMN     "workedOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "HourEntry_workedOn_idx" ON "HourEntry"("workedOn");

