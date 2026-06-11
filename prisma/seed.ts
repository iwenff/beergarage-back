import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  await prisma.reservationChair.deleteMany()
  await prisma.reservation.deleteMany()
  await prisma.chair.deleteMany()
  await prisma.table.deleteMany()

  const tables = [
    {
      label: '1', positionX: 110, positionY: 580,
      chairs: 5
    },
    {
      label: '2', positionX: 115, positionY: 330,
      chairs: 8
    },
    {
      label: '3', positionX: 490, positionY: 300,
      chairs: 4
    },
    {
      label: '4', positionX: 620, positionY: 130,
      chairs: 2
    },
    {
      label: '5', positionX: 760, positionY: 80,
      chairs: 6
    },
    {
      label: '6', positionX: 840, positionY: 230,
      chairs: 2
    },
    {
      label: '7', positionX: 490, positionY: 800,
      chairs: 2
    },
    {
      label: 'BAR', positionX: 750, positionY: 380,
      chairs: 8
    },
  ]

  for (const t of tables) {
    const table = await prisma.table.create({
      data: { label: t.label, positionX: t.positionX, positionY: t.positionY }
    })
    for (let i = 1; i <= t.chairs; i++) {
      await prisma.chair.create({
        data: {
          tableId: table.id,
          label: `${t.label}-${i}`,
          positionX: 0,
          positionY: 0,
        }
      })
    }
  }

  console.log('Seed done')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
