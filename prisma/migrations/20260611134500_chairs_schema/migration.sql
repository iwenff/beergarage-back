-- DropForeignKey Reservation_userId
ALTER TABLE "Reservation" DROP CONSTRAINT IF EXISTS "Reservation_userId_fkey";

-- DropForeignKey User_reservations (if any)
ALTER TABLE "Reservation" DROP COLUMN IF EXISTS "userId";

-- Make guestName/guestPhone NOT NULL (fill NULLs first)
UPDATE "Reservation" SET "guestName" = 'Гость' WHERE "guestName" IS NULL;
UPDATE "Reservation" SET "guestPhone" = '' WHERE "guestPhone" IS NULL;
ALTER TABLE "Reservation" ALTER COLUMN "guestName" SET NOT NULL;
ALTER TABLE "Reservation" ALTER COLUMN "guestPhone" SET NOT NULL;

-- Change date column from DATE to TEXT
ALTER TABLE "Reservation" ALTER COLUMN "date" TYPE TEXT USING to_char("date", 'YYYY-MM-DD');

-- Drop capacity from Table
ALTER TABLE "Table" DROP COLUMN IF EXISTS "capacity";
