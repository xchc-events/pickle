-- The bar's budget and the snapshot of a night's sales that explains it.
--
-- BarBudget is locked once per event, when it moves to On sale, from the
-- settlement's own bar line. BarSale holds what sold, read off Epos Now when
-- the bar is closed from the till. Nothing here orders stock or posts a sale:
-- Epos Now owns both. See src/lib/bar.ts.

-- CreateEnum
CREATE TYPE "BarBudgetBasis" AS ENUM ('ON_SALE', 'LATE');

-- CreateTable
CREATE TABLE "BarBudget" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "heads" INTEGER NOT NULL,
    "spendPerHead" DOUBLE PRECISION NOT NULL,
    "margin" DOUBLE PRECISION NOT NULL,
    "stockCostPct" DOUBLE PRECISION NOT NULL,
    "labourHours" DOUBLE PRECISION NOT NULL,
    "loadedRate" DOUBLE PRECISION NOT NULL,
    "basis" "BarBudgetBasis" NOT NULL DEFAULT 'ON_SALE',
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BarBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BarSale" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eposProductId" INTEGER,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "units" DOUBLE PRECISION NOT NULL,
    "revenue" DOUBLE PRECISION NOT NULL,
    "revenueEx" DOUBLE PRECISION NOT NULL,
    "cost" DOUBLE PRECISION NOT NULL,
    "costKnown" BOOLEAN NOT NULL,

    CONSTRAINT "BarSale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BarBudget_eventId_key" ON "BarBudget"("eventId");

-- CreateIndex
CREATE INDEX "BarSale_eventId_idx" ON "BarSale"("eventId");

-- AddForeignKey
ALTER TABLE "BarBudget" ADD CONSTRAINT "BarBudget_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarSale" ADD CONSTRAINT "BarSale_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

