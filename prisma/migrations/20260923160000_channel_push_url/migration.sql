-- The live link, so it can be copied and sent on rather than hunted for.
--
-- Connor, 23 Sep 2026: "It would be good to have the links in here — the
-- actual links for Facebook and the others — so if you need to copy them and
-- send them to anyone, you can easily grab them from here." A manual channel
-- types it in when the push is ticked off; an auto-sync one records what its
-- client handed back. Nullable: every push recorded before this column
-- existed, and any client that returns nothing, is still a push.

-- AlterTable
ALTER TABLE "ChannelPush" ADD COLUMN "url" TEXT;
