-- AlterTable
ALTER TABLE "User" ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "organisationId" TEXT,
ADD COLUMN     "phone" TEXT;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Payee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------- backfill ---
--
-- Scope moves from `Event.promoter` (free text, matched by substring) onto
-- `Event.promoterId` (a relation, matched exactly). Nothing has ever written
-- `promoterId` — `ownPayee` in portal-data.ts creates an organisation lazily
-- on a promoter's first portal visit — so without this every external user
-- would correctly see nothing at all.
--
-- Three steps, in order: make the organisations, point the events at them,
-- point the people at them.

-- 1. One Payee per distinct external promoter name.
--
-- `internal` events are excluded: their promoter field holds
-- "internal · Ana Kelliher", which names a staff member, not an organisation.
-- Names already present as a PROMOTER payee are left alone rather than
-- duplicated.
INSERT INTO "Payee" ("id", "kind", "name", "country", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  'PROMOTER',
  TRIM(e."promoter"),
  'NZ',
  NOW(),
  NOW()
FROM (SELECT DISTINCT "promoter" FROM "Event"
      WHERE "internal" = false
        AND "promoter" IS NOT NULL
        AND TRIM("promoter") <> '') AS e
WHERE NOT EXISTS (
  SELECT 1 FROM "Payee" p
  WHERE p."kind" = 'PROMOTER' AND p."name" = TRIM(e."promoter")
);

-- 2. Point each external event at its organisation.
UPDATE "Event" e
SET "promoterId" = p."id"
FROM "Payee" p
WHERE p."kind" = 'PROMOTER'
  AND p."name" = TRIM(e."promoter")
  AND e."internal" = false
  AND e."promoter" IS NOT NULL
  AND e."promoterId" IS NULL;

-- 3. Point each external user at theirs.
--
-- An exact name match, deliberately: `User.promoter` was seeded with the same
-- strings as `Event.promoter`. Anything that does not match exactly is left
-- null, which fails closed — that user sees nothing until a coordinator links
-- them in Admin. Failing open here would recreate the bug this migration
-- exists to fix.
UPDATE "User" u
SET "organisationId" = p."id"
FROM "Payee" p
WHERE p."kind" = 'PROMOTER'
  AND p."name" = TRIM(u."promoter")
  AND u."role" = 'PROMOTER'
  AND u."promoter" IS NOT NULL
  AND u."organisationId" IS NULL;
