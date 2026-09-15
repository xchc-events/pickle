-- At most one confirmed booking per room per night.
--
-- Measured before it was added: under the default READ COMMITTED, two
-- coordinators confirming the same night at once double-booked the room in
-- one race out of 40. holds-data.ts now runs every ladder mutation Serializable
-- and retries conflicts, which on its own brought that to zero across 240
-- races. This index is the guarantee underneath that does not depend on the
-- application getting its isolation level right.
--
-- Partial, so any number of HELD and RELEASED rows can share a slot — the
-- ladder depends on that. Prisma cannot declare a partial index in
-- schema.prisma, so it lives only here. Checked: neither `migrate diff` (the
-- CI drift check) nor `migrate dev` treats it as drift or generates a DROP.
--
-- This will fail to apply to a database that already holds a double booking.
-- That is correct — it names the duplicate, which has to be resolved by hand.
CREATE UNIQUE INDEX "Hold_one_confirmed_per_night"
  ON "Hold" ("spaceId", "date")
  WHERE "state" = 'CONFIRMED';
