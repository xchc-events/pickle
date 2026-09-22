-- Connor's 22 Sep 2026 pay policy: contractors are paid $35/h, employees
-- $30/h base (see the dated note above `CFG` in src/lib/finance.ts). Every
-- person defaults to CONTRACTOR — that is the standing rule, "everyone who
-- is not an employee is a contractor" — so nothing has to be backfilled for
-- the people already on the books.
CREATE TYPE "Employment" AS ENUM ('EMPLOYEE', 'CONTRACTOR');

ALTER TABLE "Person" ADD COLUMN "employment" "Employment" NOT NULL DEFAULT 'CONTRACTOR';
