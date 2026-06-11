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

    const chairs = await this.prisma.chair.findMany({
      where: { id: { in: dto.chairIds } },
      include: { table: true },
    });

    if (chairs.length !== dto.chairIds.length) {
      throw new NotFoundException('Один или несколько стульев не найдены');
    }

    const conflict = await this.prisma.reservationChair.findFirst({
      where: {
        chairId: { in: dto.chairIds },
        reservation: {
          date,
          status: { not: ReservationStatus.CANCELLED as any },
          AND: [{ timeStart: { lt: dto.timeEnd } }, { timeEnd: { gt: dto.timeStart } }],
        },
      },
    });

    if (conflict) {
      throw new BadRequestException('Один или несколько стульев уже забронированы на это время');
    }

    const reservation = await this.prisma.reservation.create({
      data: {
        date,
        timeStart: dto.timeStart,
        timeEnd: dto.timeEnd,
        guestName: dto.guestName,
        guestPhone: dto.guestPhone,
        chairs: {
          create: dto.chairIds.map((chairId) => ({ chairId })),
        },
      },
      include: {
        chairs: {
          include: { chair: { include: { table: true } } },
        },
      },
    });

    this.telegram
      .sendReservationNotification({
        guestName: dto.guestName ?? 'Гость',
        guestPhone: dto.guestPhone ?? '',
        date,
        timeStart: dto.timeStart,
        timeEnd: dto.timeEnd,
        chairs: chairs.map((c) => ({ label: c.label, tableLabel: c.table.label })),
      })
      .catch(() => {});

    return reservation;
  }

  async findByUser(userId: number) {
    return this.prisma.reservation.findMany({
      where: { userId },
      include: {
        chairs: { include: { chair: { include: { table: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAll() {
    return this.prisma.reservation.findMany({
      include: {
        user: true,
        chairs: { include: { chair: { include: { table: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async cancel(id: number, userId: number, userRole: string) {
    const reservation = await this.ensureExists(id);

    if (userRole === 'CLIENT' && reservation.userId !== userId) {
      throw new ForbiddenException('Вы можете отменить только свою бронь');
    }

    if (reservation.status === (ReservationStatus.CANCELLED as any)) {
      throw new BadRequestException('Бронь уже отменена');
    }

    return this.prisma.reservation.update({
      where: { id },
      data: { status: ReservationStatus.CANCELLED as any },
    });
  }

  async confirm(id: number) {
    const reservation = await this.ensureExists(id);

    if (reservation.status === (ReservationStatus.CONFIRMED as any)) {
      throw new BadRequestException('Бронь уже подтверждена');
    }

    return this.prisma.reservation.update({
      where: { id },
      data: { status: ReservationStatus.CONFIRMED as any },
    });
  }

  private async ensureExists(id: number) {
    const reservation = await this.prisma.reservation.findUnique({ where: { id } });
    if (!reservation) throw new NotFoundException(`Бронь ${id} не найдена`);
    return reservation;
  }
}
