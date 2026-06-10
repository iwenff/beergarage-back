import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { ReservationStatus } from '../../shared/types';

@Injectable()
export class ReservationsService {
  constructor(
    private prisma: PrismaService,
    private telegram: TelegramService,
  ) {}

  async create(dto: CreateReservationDto) {
    const date = new Date(dto.date);

    const table = await this.prisma.table.findUnique({ where: { id: dto.tableId } });
    if (!table) throw new NotFoundException('Table not found');

    const conflict = await this.prisma.reservation.findFirst({
      where: {
        tableId: dto.tableId,
        date,
        status: { not: ReservationStatus.CANCELLED as any },
        AND: [{ timeStart: { lt: dto.timeEnd } }, { timeEnd: { gt: dto.timeStart } }],
      },
    });
    if (conflict) throw new BadRequestException('Table is already reserved for this time slot');

    const reservation = await this.prisma.reservation.create({
      data: {
        tableId:    dto.tableId,
        date,
        timeStart:  dto.timeStart,
        timeEnd:    dto.timeEnd,
        guestsCount: dto.guestsCount,
        guestName:  dto.guestName,
        guestPhone: dto.guestPhone,
      },
      include: { table: true },
    });

    const freeTables = await this.getFreeTables(date, dto.timeStart, dto.timeEnd, dto.tableId);

    this.telegram
      .sendReservationNotification({
        tableLabel: reservation.table.label,
        date:       reservation.date,
        timeStart:  reservation.timeStart,
        timeEnd:    reservation.timeEnd,
        guestsCount: reservation.guestsCount,
        clientName:  reservation.guestName,
        clientPhone: reservation.guestPhone,
        freeTables:  freeTables.map((t) => ({ label: t.label, capacity: t.capacity })),
      })
      .catch(() => {});

    return reservation;
  }

  async findByUser(userId: number) {
    return this.prisma.reservation.findMany({
      where: { userId },
      include: { table: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAll() {
    return this.prisma.reservation.findMany({
      include: { user: true, table: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async cancel(id: number, userId: number, userRole: string) {
    const reservation = await this.ensureExists(id);

    if (userRole === 'CLIENT' && reservation.userId !== userId) {
      throw new ForbiddenException('You can only cancel your own reservations');
    }

    if (reservation.status === (ReservationStatus.CANCELLED as any)) {
      throw new BadRequestException('Reservation is already cancelled');
    }

    return this.prisma.reservation.update({
      where: { id },
      data: { status: ReservationStatus.CANCELLED as any },
    });
  }

  async confirm(id: number) {
    const reservation = await this.ensureExists(id);

    if (reservation.status === (ReservationStatus.CONFIRMED as any)) {
      throw new BadRequestException('Reservation is already confirmed');
    }

    return this.prisma.reservation.update({
      where: { id },
      data: { status: ReservationStatus.CONFIRMED as any },
    });
  }

  private async ensureExists(id: number) {
    const reservation = await this.prisma.reservation.findUnique({ where: { id } });
    if (!reservation) throw new NotFoundException(`Reservation ${id} not found`);
    return reservation;
  }

  private async getFreeTables(date: Date, timeStart: string, timeEnd: string, excludeTableId: number) {
    const allTables = await this.prisma.table.findMany();
    const occupied = await this.prisma.reservation.findMany({
      where: {
        date,
        status: { not: ReservationStatus.CANCELLED as any },
        AND: [{ timeStart: { lt: timeEnd } }, { timeEnd: { gt: timeStart } }],
      },
      select: { tableId: true },
    });
    const occupiedIds = new Set(occupied.map((r) => r.tableId));
    return allTables.filter((t) => !occupiedIds.has(t.id) && t.id !== excludeTableId);
  }
}
