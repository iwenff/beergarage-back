import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { ReservationStatus } from '../../shared/types';

@Injectable()
export class TablesService {
  constructor(private prisma: PrismaService) {}

  async findAll(date?: string, timeStart?: string, timeEnd?: string) {
    const tables = await this.prisma.table.findMany();

    if (!date || !timeStart || !timeEnd) {
      return tables.map((t) => ({ ...t, isAvailable: null }));
    }

    const queryDate = new Date(date);
    const occupiedIds = await this.getOccupiedTableIds(queryDate, timeStart, timeEnd);

    return tables.map((t) => ({
      ...t,
      isAvailable: !occupiedIds.has(t.id),
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

  async findFreeForSlot(date: Date, timeStart: string, timeEnd: string) {
    const allTables = await this.prisma.table.findMany();
    const occupiedIds = await this.getOccupiedTableIds(date, timeStart, timeEnd);
    return allTables.filter((t) => !occupiedIds.has(t.id));
  }

  private async getOccupiedTableIds(date: Date, timeStart: string, timeEnd: string) {
    const occupied = await this.prisma.reservation.findMany({
      where: {
        date,
        status: { not: ReservationStatus.CANCELLED as any },
        AND: [{ timeStart: { lt: timeEnd } }, { timeEnd: { gt: timeStart } }],
      },
      select: { tableId: true },
    });
    return new Set(occupied.map((r) => r.tableId));
  }

  private async ensureExists(id: number) {
    const table = await this.prisma.table.findUnique({ where: { id } });
    if (!table) throw new NotFoundException(`Table ${id} not found`);
    return table;
  }
}
