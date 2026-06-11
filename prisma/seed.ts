import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TABLES = [
  {
    label: '1',
    capacity: 2,
    positionX: 150,
    positionY: 200,
    chairs: [
      { label: '1-1', positionX: 120, positionY: 165 },
      { label: '1-2', positionX: 180, positionY: 165 },
    ],
  },
  {
    label: '2',
    capacity: 6,
    positionX: 350,
    positionY: 200,
    chairs: [
      { label: '2-1', positionX: 310, positionY: 160 },
      { label: '2-2', positionX: 350, positionY: 150 },
      { label: '2-3', positionX: 390, positionY: 160 },
      { label: '2-4', positionX: 390, positionY: 240 },
      { label: '2-5', positionX: 350, positionY: 250 },
      { label: '2-6', positionX: 310, positionY: 240 },
    ],
  },
  {
    label: '3',
    capacity: 4,
    positionX: 550,
    positionY: 200,
    chairs: [
      { label: '3-1', positionX: 515, positionY: 165 },
      { label: '3-2', positionX: 585, positionY: 165 },
      { label: '3-3', positionX: 585, positionY: 235 },
      { label: '3-4', positionX: 515, positionY: 235 },
    ],
  },
  {
    label: '4',
    capacity: 4,
    positionX: 750,
    positionY: 200,
    chairs: [
      { label: '4-1', positionX: 715, positionY: 165 },
      { label: '4-2', positionX: 785, positionY: 165 },
      { label: '4-3', positionX: 785, positionY: 235 },
      { label: '4-4', positionX: 715, positionY: 235 },
    ],
  },
  {
    label: 'BAR',
    capacity: 10,
    positionX: 500,
    positionY: 500,
    chairs: Array.from({ length: 10 }, (_, i) => ({
      label: `BAR-${i + 1}`,
      positionX: 55 + i * 90,
      positionY: 440,
    })),
  },
  {
    label: 'VIP',
    capacity: 10,
    positionX: 500,
    positionY: 700,
    chairs: Array.from({ length: 10 }, (_, i) => ({
      label: `VIP-${i + 1}`,
      positionX: 55 + i * 90,
      positionY: 640,
    })),
  },
];

async function main() {
  await prisma.reservationChair.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.chair.deleteMany();
  await prisma.table.deleteMany();

  for (const { chairs, ...tableData } of TABLES) {
    const table = await prisma.table.create({ data: tableData });
    await prisma.chair.createMany({
      data: chairs.map((c) => ({ ...c, tableId: table.id })),
    });
    console.log(`Created table "${table.label}" with ${chairs.length} chairs`);
  }

  console.log('Seed completed successfully');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
