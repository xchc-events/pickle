-- Passwords, and sessions this product issues itself.
--
-- Auth.js is gone. It could not give a password sign-in a database session —
-- it forces a JWT for credentials, and a JWT cannot be taken back — so sign-in
-- is now done in-house: src/lib/auth.ts. The email link stays as a second way
-- in, and as the way a password is set and reset.
--
-- ⚠ Applying this signs everybody out once. The old session tokens were stored
-- in the clear under Auth.js's cookie name; the new ones are stored hashed
-- under our own. There is nothing to carry across, and a session that
-- survived would be one nobody can end.

-- CreateEnum
CREATE TYPE "SignInMethod" AS ENUM ('PASSWORD', 'EMAIL_LINK');

-- CreateEnum
CREATE TYPE "AuthTokenPurpose" AS ENUM ('SIGN_IN', 'INVITE', 'RESET');

-- CreateEnum
CREATE TYPE "AuthEventKind" AS ENUM ('PASSWORD_SIGN_IN', 'PASSWORD_FAILED', 'LINK_SIGN_IN', 'LINK_SENT', 'INVITE_SENT', 'RESET_SENT', 'PASSWORD_SET', 'PASSWORD_RESET', 'PASSWORD_CHANGED', 'SIGNED_OUT', 'SESSIONS_ENDED', 'REFUSED_INACTIVE');

-- Credentials on the account.
ALTER TABLE "User"
ADD COLUMN     "lastSignInAt" TIMESTAMP(3),
ADD COLUMN     "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN     "passwordHash" TEXT;

-- Auth.js stamped `emailVerified` each time an emailed link was used, so it is
-- the last sign-in by the only route there was. Carried across before the
-- column goes, so Admin does not suddenly show everybody as never signed in.
UPDATE "User" SET "lastSignInAt" = "emailVerified" WHERE "emailVerified" IS NOT NULL;

-- `image` was the adapter's, for OAuth avatars. Nothing ever wrote it.
ALTER TABLE "User" DROP COLUMN "emailVerified",
DROP COLUMN "image";

-- Sessions: everybody out, then the new shape. See the note at the top.
DELETE FROM "Session";

-- DropIndex
DROP INDEX "Session_sessionToken_key";

-- AlterTable
ALTER TABLE "Session" DROP COLUMN "sessionToken",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "method" "SignInMethod" NOT NULL,
ADD COLUMN     "tokenHash" TEXT NOT NULL,
ADD COLUMN     "userAgent" TEXT,
ADD CONSTRAINT "Session_pkey" PRIMARY KEY ("id");

-- The adapter's other two tables. `Account` held OAuth links and was always
-- empty — there was never an OAuth provider. `VerificationToken` held unspent
-- sign-in links, which stop working with this migration anyway.

-- DropForeignKey
ALTER TABLE "Account" DROP CONSTRAINT "Account_userId_fkey";

-- DropTable
DROP TABLE "Account";

-- DropTable
DROP TABLE "VerificationToken";

-- CreateTable
CREATE TABLE "AuthToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" "AuthTokenPurpose" NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthEvent" (
    "id" TEXT NOT NULL,
    "kind" "AuthEventKind" NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "actorId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthToken_userId_purpose_idx" ON "AuthToken"("userId", "purpose");

-- CreateIndex
CREATE INDEX "AuthEvent_email_at_idx" ON "AuthEvent"("email", "at");

-- CreateIndex
CREATE INDEX "AuthEvent_userId_at_idx" ON "AuthEvent"("userId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- AddForeignKey
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthEvent" ADD CONSTRAINT "AuthEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthEvent" ADD CONSTRAINT "AuthEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
