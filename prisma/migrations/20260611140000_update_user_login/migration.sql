-- Add login column (nullable first to handle existing rows)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "login" TEXT;
UPDATE "User" SET "login" = COALESCE("email", 'user_' || "id"::TEXT) WHERE "login" IS NULL;
ALTER TABLE "User" ALTER COLUMN "login" SET NOT NULL;

-- Add unique constraint on login
DO $$ BEGIN
  ALTER TABLE "User" ADD CONSTRAINT "User_login_key" UNIQUE ("login");
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- Make passwordHash NOT NULL
UPDATE "User" SET "passwordHash" = '' WHERE "passwordHash" IS NULL;
ALTER TABLE "User" ALTER COLUMN "passwordHash" SET NOT NULL;

-- Drop old columns
DROP INDEX IF EXISTS "User_email_key";
ALTER TABLE "User" DROP COLUMN IF EXISTS "email";
ALTER TABLE "User" DROP COLUMN IF EXISTS "phone";
ALTER TABLE "User" DROP COLUMN IF EXISTS "discountPercent";

-- Add blockedManually to Chair
ALTER TABLE "Chair" ADD COLUMN IF NOT EXISTS "blockedManually" BOOLEAN NOT NULL DEFAULT false;
