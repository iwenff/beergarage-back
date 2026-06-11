import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import { TablesService } from '../tables/tables.service';
import { CreateReservationDto } from './dto/create-reservation.dto';

@Injectable()
export class ReservationsService {
  constructor(
    private prisma: PrismaService,
    private telegram: TelegramService,
    private tables: TablesService,
  ) {}

  async create(dto: CreateReservationDto) {
    const chairs = await this.prisma.chair.findMany({
      where: { id: { in: dto.chairIds } },
      include: { table: true },
    });

    if (chairs.length !== dto.chairIds.length) {
      throw new NotFoundException('Один или несколько стульев не найдены');
    }

    const reservedIds = await this.tables.getReservedChairIds(dto.date, dto.timeStart, dto.timeEnd);
    const busyChairs = dto.chairIds.filter((id) => reservedIds.has(id));

    if (busyChairs.length > 0) {
      const busyLabels = chairs
        .filter((c) => busyChairs.includes(c.id))
        .map((c) => c.label)
        .join(', ');
      throw new BadRequestException(`Стулья уже заняты на это время: ${busyLabels}`);
    }

    const reservation = await this.prisma.reservation.create({
      data: {
        date: dto.date,
        timeStart: dto.timeStart,
        timeEnd: dto.timeEnd,
        guestName: dto.guestName,
        guestPhone: dto.guestPhone,
        chairs: {
          create: dto.chairIds.map((chairId) => ({ chairId })),
        },
      },
      include: {
        chairs: { include: { chair: { include: { table: true } } } },
      },
    });

    this.sendTelegramNotification(dto, chairs).catch(() => {});

    return reservation;
  }

  async findAll() {
    return this.prisma.reservation.findMany({
      include: {
        chairs: { include: { chair: { include: { table: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async cancel(id: number) {
    const reservation = await this.ensureExists(id);

    if (reservation.status === 'CANCELLED') {
      throw new BadRequestException('Бронь уже отменена');
    }

    return this.prisma.reservation.update({
      where: { id },
      data: { status: 'CANCELLED' as any },
    });
  }

  async confirm(id: number) {
    const reservation = await this.ensureExists(id);

    if (reservation.status === 'CONFIRMED') {
      throw new BadRequestException('Бронь уже подтверждена');
    }

    return this.prisma.reservation.update({
      where: { id },
      data: { status: 'CONFIRMED' as any },
    });
  }

  private async sendTelegramNotification(
    dto: CreateReservationDto,
    chairs: { label: string; table: { label: string } }[],
  ) {
    const allChairs = await this.prisma.chair.count();
    const reservedAfter = await this.prisma.reservationChair.count({
      where: {
        reservation: {
          date: dto.date,
          status: { not: 'CANCELLED' as any },
          AND: [{ timeStart: { lt: dto.timeEnd } }, { timeEnd: { gt: dto.timeStart } }],
        },
      },
    });
    const freeChairsCount = allChairs - reservedAfter;

    await this.telegram.sendReservationNotification({
      guestName: dto.guestName,
      guestPhone: dto.guestPhone,
      date: dto.date,
      timeStart: dto.timeStart,
      timeEnd: dto.timeEnd,
      chairs: chairs.map((c) => ({ label: c.label, tableLabel: c.table.label })),
      freeChairsCount,
    });
  }

  private async ensureExists(id: number) {
    const reservation = await this.prisma.reservation.findUnique({ where: { id } });
    if (!reservation) throw new NotFoundException(`Бронь ${id} не найдена`);
    return reservation;
  }
}
