-- AlterTable User: make all fields nullable
ALTER TABLE "User" ALTER COLUMN "name" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- AlterTable Table: change positionX/Y from DoublePrecision to Integer
ALTER TABLE "Table" ALTER COLUMN "positionX" TYPE INTEGER USING "positionX"::INTEGER;
ALTER TABLE "Table" ALTER COLUMN "positionY" TYPE INTEGER USING "positionY"::INTEGER;

-- DropForeignKey Reservation_tableId
ALTER TABLE "Reservation" DROP CONSTRAINT IF EXISTS "Reservation_tableId_fkey";

-- AlterTable Reservation: drop old columns, make guest fields nullable
ALTER TABLE "Reservation" DROP COLUMN IF EXISTS "tableId";
ALTER TABLE "Reservation" DROP COLUMN IF EXISTS "guestsCount";
ALTER TABLE "Reservation" ALTER COLUMN "guestName" DROP NOT NULL;
ALTER TABLE "Reservation" ALTER COLUMN "guestPhone" DROP NOT NULL;

-- CreateTable Chair
CREATE TABLE "Chair" (
    "id" SERIAL NOT NULL,
    "tableId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "positionX" INTEGER NOT NULL,
    "positionY" INTEGER NOT NULL,
    CONSTRAINT "Chair_pkey" PRIMARY KEY ("id")
);

-- CreateTable ReservationChair
CREATE TABLE "ReservationChair" (
    "id" SERIAL NOT NULL,
    "reservationId" INTEGER NOT NULL,
    "chairId" INTEGER NOT NULL,
    CONSTRAINT "ReservationChair_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey Chair -> Table
ALTER TABLE "Chair" ADD CONSTRAINT "Chair_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey ReservationChair -> Reservation
ALTER TABLE "ReservationChair" ADD CONSTRAINT "ReservationChair_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey ReservationChair -> Chair
ALTER TABLE "ReservationChair" ADD CONSTRAINT "ReservationChair_chairId_fkey" FOREIGN KEY ("chairId") REFERENCES "Chair"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
