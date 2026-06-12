import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { UpdateChairsDto } from './dto/update-chairs.dto';
import { formatDateRu, todayStr } from '../../shared/utils/date.util';

const CHAIR_INCLUDE = {
  chairs: {
    include: { chair: { include: { table: true } } },
  },
} as const;

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private telegram: TelegramService,
  ) {}

  async getReservations(date?: string, status?: string) {
    const where: any = {};

    if (date === 'today') {
      where.date = todayStr();
    } else if (date) {
      where.date = date;
    }

    if (status) {
      where.status = status;
    }

    const reservations = await this.prisma.reservation.findMany({
      where,
      include: CHAIR_INCLUDE,
      orderBy: [{ date: 'asc' }, { timeStart: 'asc' }],
    });

    return reservations.map((r) => this.formatReservation(r));
  }

  async confirmReservation(id: number) {
    const r = await this.ensureExists(id);
    if (r.status === 'CONFIRMED') throw new BadRequestException('Бронь уже подтверждена');

    const updated = await this.prisma.reservation.update({
      where: { id },
      data: { status: 'CONFIRMED' },
      include: CHAIR_INCLUDE,
    });

    this.telegram.sendConfirmation(id, this.toReservationInfo(updated)).catch(() => {});
    return this.formatReservation(updated);
  }

  async cancelReservation(id: number) {
    const r = await this.ensureExists(id);
    if (r.status === 'CANCELLED') throw new BadRequestException('Бронь уже отменена');

    const updated = await this.prisma.reservation.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: CHAIR_INCLUDE,
    });

    this.telegram.sendCancellation(id, this.toReservationInfo(updated)).catch(() => {});
    return this.formatReservation(updated);
  }

  async updateReservation(id: number, dto: UpdateReservationDto) {
    await this.ensureExists(id);
    const updated = await this.prisma.reservation.update({
      where: { id },
      data: dto as any,
      include: CHAIR_INCLUDE,
    });
    return this.formatReservation(updated);
  }

  async deleteReservation(id: number) {
    const r = await this.ensureExists(id);
    if (r.status !== 'CANCELLED') {
      throw new BadRequestException('Удалить можно только отменённую бронь');
    }
    await this.prisma.reservationChair.deleteMany({ where: { reservationId: id } });
    await this.prisma.reservation.delete({ where: { id } });
    return { success: true };
  }

  async updateChairs(tableId: number, dto: UpdateChairsDto) {
    await Promise.all(
      dto.chairs.map((c) =>
        this.prisma.chair.update({
          where: { id: c.id, tableId },
          data: c.status === 'blocked'
            ? {
                blockedManually: true,
                blockColor:     c.blockColor     ?? '#facc15',
                blockDate:      c.blockDate      ?? null,
                blockTimeStart: c.blockTimeStart ?? null,
                blockTimeEnd:   c.blockTimeEnd   ?? null,
              }
            : {
                blockedManually: false,
                blockColor:     null,
                blockDate:      null,
                blockTimeStart: null,
                blockTimeEnd:   null,
              },
        }),
      ),
    );
    return { success: true };
  }

  private formatReservation(r: any) {
    return {
      id: r.id,
      guestName: r.guestName,
      guestPhone: r.guestPhone,
      date: formatDateRu(r.date),
      timeStart: r.timeStart,
      timeEnd: r.timeEnd,
      status: r.status,
      createdAt: r.createdAt,
      chairs: r.chairs.map((rc: any) => ({
        id: rc.chair.id,
        label: rc.chair.label,
        table: { id: rc.chair.table.id, label: rc.chair.table.label },
      })),
    };
  }

  private toReservationInfo(r: any) {
    return {
      guestName: r.guestName,
      guestPhone: r.guestPhone,
      date: r.date,
      timeStart: r.timeStart,
      timeEnd: r.timeEnd,
      chairs: r.chairs.map((rc: any) => ({
        label: rc.chair.label,
        tableLabel: rc.chair.table.label,
      })),
    };
  }

  private async ensureExists(id: number) {
    const r = await this.prisma.reservation.findUnique({ where: { id } });
    if (!r) throw new NotFoundException(`Бронь ${id} не найдена`);
    return r;
  }
}
