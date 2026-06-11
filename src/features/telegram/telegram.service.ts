import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Context } from 'telegraf';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { formatDateRu } from '../../shared/utils/date.util';

type ReservationInfo = {
  guestName: string;
  guestPhone: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  chairs: { label: string; tableLabel: string }[];
};

type NewReservationData = ReservationInfo & { freeChairsCount: number };

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly bot: Telegraf;
  private readonly chatMain: string;
  private readonly chatOwner: string;
  private readonly chatStaff: string;
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    this.bot = new Telegraf(this.config.get<string>('TELEGRAM_BOT_TOKEN')!);
    this.chatMain  = this.config.get<string>('TELEGRAM_CHAT_ID') ?? '';
    this.chatOwner = this.config.get<string>('TELEGRAM_CHAT_ID_OWNER') ?? '';
    this.chatStaff = this.config.get<string>('TELEGRAM_CHAT_ID_STAFF') ?? '';
    this.setupBotHandlers();
  }

  onModuleInit() {
    if (!this.config.get('TELEGRAM_BOT_TOKEN')) return;
    this.bot.launch().catch((err) => this.logger.warn('Bot polling error', err));
  }

  onModuleDestroy() {
    this.bot.stop('NestJS shutdown');
  }

  // ─── Notifications ────────────────────────────────────────────────────────

  async sendNewReservation(data: NewReservationData) {
    const chairsByTable = groupChairsByTableLabel(data.chairs);
    const message = [
      '🍺 Новая бронь!',
      '',
      `👤 Гость: ${data.guestName}`,
      `📞 Телефон: ${data.guestPhone}`,
      `📅 Дата: ${formatDateRu(data.date)}`,
      `⏰ Время: ${data.timeStart} - ${data.timeEnd}`,
      `👥 Количество персон: ${data.chairs.length}`,
      `🪑 Места: ${chairsByTable}`,
      '',
      `Свободных мест осталось на это время: ${data.freeChairsCount}`,
    ].join('\n');
    await this.broadcast([this.chatMain, this.chatOwner, this.chatStaff], message);
  }

  async sendCancellation(reservationId: number, data: ReservationInfo) {
    const message = [
      `🚫 Бронь #${reservationId} отменена`,
      '',
      `👤 Гость: ${data.guestName}`,
      `📞 Телефон: ${data.guestPhone}`,
      `📅 Дата: ${formatDateRu(data.date)}`,
      `⏰ Время: ${data.timeStart} - ${data.timeEnd}`,
      `🪑 Места: ${groupChairsByTableLabel(data.chairs)}`,
    ].join('\n');
    await this.broadcast([this.chatMain, this.chatOwner, this.chatStaff], message);
  }

  async sendConfirmation(reservationId: number, data: ReservationInfo) {
    const message = [
      `✅ Бронь #${reservationId} подтверждена`,
      '',
      `👤 Гость: ${data.guestName}`,
      `📞 Телефон: ${data.guestPhone}`,
      `📅 Дата: ${formatDateRu(data.date)}`,
      `⏰ Время: ${data.timeStart} - ${data.timeEnd}`,
      `🪑 Места: ${groupChairsByTableLabel(data.chairs)}`,
    ].join('\n');
    await this.broadcast([this.chatStaff, this.chatMain], message);
  }

  async sendBotChange(reservationId: number, description: string) {
    const message = `🤖 Изменение брони #${reservationId}\n\n${description}`;
    await this.broadcast([this.chatMain, this.chatOwner, this.chatStaff], message);
  }

  // ─── Bot handlers ─────────────────────────────────────────────────────────

  private setupBotHandlers() {
    const allowedChats = new Set(
      [this.chatMain, this.chatOwner, this.chatStaff].filter(Boolean),
    );

    const guard = (ctx: Context) => {
      const id = String(ctx.chat?.id ?? '');
      return allowedChats.size === 0 || allowedChats.has(id);
    };

    this.bot.command('bookings', async (ctx) => {
      if (!guard(ctx)) return;
      try {
        const text = await this.formatBookingsList();
        await ctx.reply(text);
      } catch (err) {
        this.logger.error('Bot /bookings error', err);
      }
    });

    this.bot.on('text', async (ctx) => {
      if (!guard(ctx)) return;
      const text = (ctx.message as any).text as string;

      const confirmMatch = text.match(/^\/confirm_(\d+)$/);
      if (confirmMatch) {
        await this.handleBotConfirm(parseInt(confirmMatch[1]), ctx);
        return;
      }

      const cancelMatch = text.match(/^\/cancel_(\d+)$/);
      if (cancelMatch) {
        await this.handleBotCancel(parseInt(cancelMatch[1]), ctx);
        return;
      }

      const deleteMatch = text.match(/^\/delete_(\d+)$/);
      if (deleteMatch) {
        await this.handleBotDelete(parseInt(deleteMatch[1]), ctx);
        return;
      }
    });
  }

  private async handleBotConfirm(id: number, ctx: Context) {
    const r = await this.prisma.reservation.findUnique({
      where: { id },
      include: { chairs: { include: { chair: { include: { table: true } } } } },
    });
    if (!r) { await ctx.reply(`❌ Бронь #${id} не найдена`); return; }
    if (r.status === 'CONFIRMED') { await ctx.reply(`Бронь #${id} уже подтверждена`); return; }
    if (r.status === 'CANCELLED') { await ctx.reply(`Бронь #${id} отменена — нельзя подтвердить`); return; }

    await this.prisma.reservation.update({ where: { id }, data: { status: 'CONFIRMED' } });
    await ctx.reply(`✅ Бронь #${id} подтверждена`);

    await this.sendBotChange(id,
      `Подтверждена\nГость: ${r.guestName} | ${r.guestPhone}\n${formatDateRu(r.date)} ${r.timeStart}-${r.timeEnd}`,
    ).catch(() => {});
  }

  private async handleBotCancel(id: number, ctx: Context) {
    const r = await this.prisma.reservation.findUnique({
      where: { id },
      include: { chairs: { include: { chair: { include: { table: true } } } } },
    });
    if (!r) { await ctx.reply(`❌ Бронь #${id} не найдена`); return; }
    if (r.status === 'CANCELLED') { await ctx.reply(`Бронь #${id} уже отменена`); return; }

    await this.prisma.reservation.update({ where: { id }, data: { status: 'CANCELLED' } });
    await ctx.reply(`🚫 Бронь #${id} отменена`);

    await this.sendBotChange(id,
      `Отменена\nГость: ${r.guestName} | ${r.guestPhone}\n${formatDateRu(r.date)} ${r.timeStart}-${r.timeEnd}`,
    ).catch(() => {});
  }

  private async handleBotDelete(id: number, ctx: Context) {
    const r = await this.prisma.reservation.findUnique({ where: { id } });
    if (!r) { await ctx.reply(`❌ Бронь #${id} не найдена`); return; }
    if (r.status !== 'CANCELLED') {
      await ctx.reply(`❌ Удалить можно только отменённую бронь. Текущий статус: ${r.status}`);
      return;
    }

    await this.prisma.reservationChair.deleteMany({ where: { reservationId: id } });
    await this.prisma.reservation.delete({ where: { id } });
    await ctx.reply(`🗑 Бронь #${id} удалена`);

    await this.sendBotChange(id, `Бронь удалена`).catch(() => {});
  }

  private async formatBookingsList(): Promise<string> {
    const reservations = await this.prisma.reservation.findMany({
      where: { status: { not: 'CANCELLED' } },
      include: { chairs: { include: { chair: { include: { table: true } } } } },
      orderBy: [{ date: 'asc' }, { timeStart: 'asc' }],
    });

    if (reservations.length === 0) return '📋 Активных броней нет';

    const lines = ['📋 Активные брони:'];
    for (const r of reservations) {
      const places = groupReservationChairs(r.chairs);
      const statusLabel = r.status === 'CONFIRMED' ? '✅ Подтверждена' : '⏳ Ожидает';
      lines.push('');
      lines.push(`#${r.id} | ${r.guestName} | ${r.guestPhone}`);
      lines.push(`👥 Персон: ${r.chairs.length}`);
      lines.push(`🪑 Места: ${places}`);
      lines.push(`📅 ${formatDateRu(r.date)} | ${r.timeStart} - ${r.timeEnd}`);
      lines.push(`Статус: ${statusLabel}`);
      lines.push('');
      lines.push(`/confirm_${r.id} | /cancel_${r.id} | /delete_${r.id}`);
    }
    return lines.join('\n');
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async broadcast(chatIds: string[], message: string) {
    const targets = [...new Set(chatIds.filter(Boolean))];
    await Promise.allSettled(
      targets.map((id) =>
        this.bot.telegram.sendMessage(id, message).catch((err) => {
          this.logger.error(`Failed to send to chat ${id}`, err);
        }),
      ),
    );
  }
}

function groupChairsByTableLabel(chairs: { label: string; tableLabel: string }[]): string {
  const map = new Map<string, string[]>();
  for (const c of chairs) {
    if (!map.has(c.tableLabel)) map.set(c.tableLabel, []);
    map.get(c.tableLabel)!.push(c.label);
  }
  return Array.from(map.entries())
    .map(([t, ls]) => `стол ${t} (${ls.join(', ')})`)
    .join(', ');
}

function groupReservationChairs(
  chairs: { chair: { label: string; table: { label: string } } }[],
): string {
  const map = new Map<string, string[]>();
  for (const rc of chairs) {
    const t = rc.chair.table.label;
    if (!map.has(t)) map.set(t, []);
    map.get(t)!.push(rc.chair.label);
  }
  return Array.from(map.entries())
    .map(([t, ls]) => `стол ${t} (${ls.join(', ')})`)
    .join(', ');
}
