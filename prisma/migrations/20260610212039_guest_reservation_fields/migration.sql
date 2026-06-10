/*
  Warnings:

  - Added the required column `guestName` to the `Reservation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `guestPhone` to the `Reservation` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Reservation" DROP CONSTRAINT "Reservation_userId_fkey";

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "guestName" TEXT NOT NULL,
ADD COLUMN     "guestPhone" TEXT NOT NULL,
ALTER COLUMN "userId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
