import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';

@Injectable()
export class TablesService {
  constructor(private prisma: PrismaService) {}

  async findAll(date?: string, timeStart?: string, timeEnd?: string) {
    const tables = await this.prisma.table.findMany({
      include: { chairs: true },
      orderBy: { id: 'asc' },
    });

    if (!date || !timeStart || !timeEnd) {
      return tables.map((t) => ({
        id: t.id,
        label: t.label,
        positionX: t.positionX,
        positionY: t.positionY,
        chairs: t.chairs.map((c) => ({
          id: c.id,
          label: c.label,
          positionX: c.positionX,
          positionY: c.positionY,
          status: c.blockedManually ? 'reserved' : 'free',
        })),
      }));
    }

    const reservedChairIds = await this.getReservedChairIds(date, timeStart, timeEnd);

    return tables.map((t) => ({
      id: t.id,
      label: t.label,
      positionX: t.positionX,
      positionY: t.positionY,
      chairs: t.chairs.map((c) => ({
        id: c.id,
        label: c.label,
        positionX: c.positionX,
        positionY: c.positionY,
        status: c.blockedManually || reservedChairIds.has(c.id) ? 'reserved' : 'free',
      })),
    }));
  }

  async create(dto: CreateTableDto) {
    return this.prisma.table.create({ data: dto });
  }

  async update(id: number, dto: UpdateTableDto) {
    await this.ensureExists(id);
    return this.prisma.table.update({ where: { id }, data: dto });
  }

  async remove(id: number) {
    await this.ensureExists(id);
    return this.prisma.table.delete({ where: { id } });
  }

  async getReservedChairIds(date: string, timeStart: string, timeEnd: string): Promise<Set<number>> {
    const reservationChairs = await this.prisma.reservationChair.findMany({
      where: {
        reservation: {
          date,
          status: { not: 'CANCELLED' as any },
          AND: [{ timeStart: { lt: timeEnd } }, { timeEnd: { gt: timeStart } }],
        },
      },
      select: { chairId: true },
    });
    return new Set(reservationChairs.map((rc) => rc.chairId));
  }

  private async ensureExists(id: number) {
    const table = await this.prisma.table.findUnique({ where: { id } });
    if (!table) throw new NotFoundException(`Table ${id} not found`);
    return table;
  }
}
