import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf } from 'telegraf';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { formatDateRu, formatCreatedAtRu, todayStr, currentTimeStr } from '../../shared/utils/date.util';

// ─── Types ────────────────────────────────────────────────────────────────────

type EditField = 'date' | 'time' | 'guests' | 'name' | 'phone';
type SessionEntry = { action: EditField; reservationId: number };

type ReservationInfo = {
  guestName: string;
  guestPhone: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  chairs: { label: string; tableLabel: string }[];
};

type NewReservationData = ReservationInfo & { freeChairsCount: number };

const CHAIR_INCLUDE = {
  chairs: { include: { chair: { include: { table: true } } } },
} as const;

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly bot: Telegraf;
  private readonly chatMain: string;
  private readonly chatOwner: string;
  private readonly chatStaff: string;
  private readonly logger = new Logger(TelegramService.name);
  private readonly sessionState = new Map<number, SessionEntry>();

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

  // ─── Public notifications ─────────────────────────────────────────────────

  async sendNewReservation(data: NewReservationData) {
    const message = [
      '🍺 Новая бронь!',
      '',
      `👤 Гость: ${data.guestName}`,
      `📞 Телефон: ${data.guestPhone}`,
      `📅 Дата: ${formatDateRu(data.date)}`,
      `⏰ Время: ${data.timeStart} - ${data.timeEnd}`,
      `👥 Количество персон: ${data.chairs.length}`,
      `🪑 Места: ${rcGroupByLabel(data.chairs)}`,
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
      `🪑 Места: ${rcGroupByLabel(data.chairs)}`,
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
      `🪑 Места: ${rcGroupByLabel(data.chairs)}`,
    ].join('\n');
    await this.broadcast([this.chatStaff, this.chatMain], message);
  }

  // ─── Bot setup ────────────────────────────────────────────────────────────

  private setupBotHandlers() {
    const allowedChats = new Set([this.chatMain, this.chatOwner, this.chatStaff].filter(Boolean));

    this.bot.on('text', async (ctx) => {
      const chatId = String(ctx.chat?.id ?? '');
      if (allowedChats.size > 0 && !allowedChats.has(chatId)) return;

      const text = ctx.message.text;
      const userId = ctx.from?.id ?? 0;

      // Session: user is waiting to input a value (date/time/etc.)
      const session = this.sessionState.get(userId);
      if (session && !text.startsWith('/')) {
        await this.processSessionInput(userId, session, text, ctx);
        return;
      }
      if (session) this.sessionState.delete(userId); // command cancels session

      let m: RegExpMatchArray | null;

      // Simple commands
      if (text === '/bookings') { await this.cmdBookings(ctx); return; }
      if (text === '/today')    { await this.cmdToday(ctx); return; }
      if (text === '/free')     { await this.cmdFree(ctx); return; }

      // Parameterised commands
      if ((m = text.match(/^\/confirm_(\d+)$/)))   { await this.cmdConfirm(+m[1], ctx); return; }
      if ((m = text.match(/^\/cancel_(\d+)$/)))    { await this.cmdCancel(+m[1], ctx); return; }
      if ((m = text.match(/^\/delete_(\d+)$/)))    { await this.cmdDelete(+m[1], ctx); return; }
      if ((m = text.match(/^\/status_(\d+)$/)))    { await this.cmdStatus(+m[1], ctx); return; }
      if ((m = text.match(/^\/edit_(\d+)$/)))      { await this.cmdEdit(+m[1], ctx); return; }
      if ((m = text.match(/^\/edit_(\d+)_(date|time|guests|table|name|phone)$/))) {
        await this.cmdEditField(+m[1], m[2] as EditField | 'table', userId, ctx); return;
      }
      if ((m = text.match(/^\/table_(\d+)_(.+)$/))) {
        await this.cmdSelectTable(+m[1], m[2], ctx); return;
      }
    });
  }

  // ─── Commands ─────────────────────────────────────────────────────────────

  private async cmdBookings(ctx: any) {
    try {
      const today = todayStr();
      const reservations = await this.prisma.reservation.findMany({
        where: { date: today, status: { not: 'CANCELLED' as any } },
        include: CHAIR_INCLUDE,
        orderBy: { timeStart: 'asc' },
      });

      if (!reservations.length) {
        await ctx.reply('📋 Активных броней на сегодня нет'); return;
      }

      const SEP = '━━━━━━━━━━━━━━━━━━━━';
      const lines = [`📋 Активные брони на сегодня:`];

      for (const r of reservations) {
        lines.push('', SEP);
        lines.push(`🆔 Бронь #${r.id}`);
        lines.push(`👤 ${r.guestName} | 📞 ${r.guestPhone}`);
        lines.push(`📅 ${formatDateRu(r.date)}`);
        lines.push(`⏰ ${r.timeStart} - ${r.timeEnd}`);
        lines.push(`👥 Персон: ${r.chairs.length}`);
        lines.push(`🪑 ${rcGroupByDb(r.chairs)}`);
        lines.push(`📌 Статус: ${statusLabel(r.status)}`);
        lines.push('');
        lines.push(`/confirm_${r.id} - подтвердить`);
        lines.push(`/cancel_${r.id} - отменить`);
        lines.push(`/edit_${r.id} - редактировать`);
        lines.push(`/delete_${r.id} - удалить`);
      }
      lines.push('', SEP);

      await ctx.reply(lines.join('\n'));
    } catch (err) {
      this.logger.error('/bookings error', err);
      await ctx.reply('❌ Ошибка при загрузке броней');
    }
  }

  private async cmdToday(ctx: any) {
    try {
      const today = todayStr();
      const reservations = await this.prisma.reservation.findMany({
        where: { date: today },
        include: CHAIR_INCLUDE,
        orderBy: { timeStart: 'asc' },
      });

      const dateLabel = formatDateRu(today);
      if (!reservations.length) {
        await ctx.reply(`📅 Броней на сегодня (${dateLabel}) нет`); return;
      }

      let pending = 0, confirmed = 0, cancelled = 0;
      const lines = [`📅 Брони на сегодня - ${dateLabel}`, ''];

      for (const r of reservations) {
        if (r.status === 'PENDING') pending++;
        else if (r.status === 'CONFIRMED') confirmed++;
        else cancelled++;

        const emoji = r.status === 'CONFIRMED' ? '✅' : r.status === 'CANCELLED' ? '❌' : '⏳';
        const tables = [...new Set(r.chairs.map((rc: any) => `Стол ${rc.chair.table.label}`))].join(', ');
        lines.push(`${emoji} #${r.id} ${r.guestName} | ${r.timeStart}-${r.timeEnd} | ${tables} | ${r.chairs.length} чел`);
      }

      lines.push('');
      lines.push(`Всего: ${reservations.length} | Ожидает: ${pending} | Подтверждено: ${confirmed} | Отменено: ${cancelled}`);
      await ctx.reply(lines.join('\n'));
    } catch (err) {
      this.logger.error('/today error', err);
    }
  }

  private async cmdFree(ctx: any) {
    try {
      const today = todayStr();
      const now = currentTimeStr();

      const tables = await this.prisma.table.findMany({
        include: { chairs: true },
        orderBy: { id: 'asc' },
      });
      const reservedIds = await this.getReservedChairIds(today, now, now);

      const lines = ['🟢 Свободные места прямо сейчас:', ''];
      let anyFree = false;

      for (const t of tables) {
        const free = t.chairs.filter((c) => !c.blockedManually && !reservedIds.has(c.id)).length;
        if (free > 0) {
          anyFree = true;
          lines.push(`Стол ${t.label} - ${free} из ${t.chairs.length} ${pluralize(free, 'место', 'места', 'мест')} свободно`);
        }
      }

      if (!anyFree) { await ctx.reply('🔴 Свободных мест прямо сейчас нет'); return; }
      await ctx.reply(lines.join('\n'));
    } catch (err) {
      this.logger.error('/free error', err);
    }
  }

  private async cmdConfirm(id: number, ctx: any) {
    const r = await this.prisma.reservation.findUnique({ where: { id }, include: CHAIR_INCLUDE });
    if (!r) { await ctx.reply(`❌ Бронь #${id} не найдена`); return; }
    if (r.status === 'CONFIRMED') { await ctx.reply(`Бронь #${id} уже подтверждена`); return; }
    if (r.status === 'CANCELLED') { await ctx.reply(`❌ Бронь #${id} отменена — нельзя подтвердить`); return; }

    await this.prisma.reservation.update({ where: { id }, data: { status: 'CONFIRMED' } });
    await ctx.reply(`✅ Бронь #${id} подтверждена`);
    await this.sendConfirmation(id, this.toInfo(r)).catch(() => {});
  }

  private async cmdCancel(id: number, ctx: any) {
    const r = await this.prisma.reservation.findUnique({ where: { id }, include: CHAIR_INCLUDE });
    if (!r) { await ctx.reply(`❌ Бронь #${id} не найдена`); return; }
    if (r.status === 'CANCELLED') { await ctx.reply(`Бронь #${id} уже отменена`); return; }

    await this.prisma.reservation.update({ where: { id }, data: { status: 'CANCELLED' } });
    await ctx.reply(`🚫 Бронь #${id} отменена`);
    await this.sendCancellation(id, this.toInfo(r)).catch(() => {});
  }

  private async cmdDelete(id: number, ctx: any) {
    const r = await this.prisma.reservation.findUnique({ where: { id } });
    if (!r) { await ctx.reply(`❌ Бронь #${id} не найдена`); return; }
    if (r.status !== 'CANCELLED') {
      await ctx.reply(`❌ Удалить можно только отменённую бронь. Статус: ${r.status}`); return;
    }
    await this.prisma.reservationChair.deleteMany({ where: { reservationId: id } });
    await this.prisma.reservation.delete({ where: { id } });
    await ctx.reply(`🗑 Бронь #${id} удалена`);
    await this.broadcast([this.chatMain, this.chatOwner, this.chatStaff], `🗑 Бронь #${id} удалена`).catch(() => {});
  }

  private async cmdStatus(id: number, ctx: any) {
    const r = await this.prisma.reservation.findUnique({ where: { id }, include: CHAIR_INCLUDE });
    if (!r) { await ctx.reply(`❌ Бронь #${id} не найдена`); return; }

    const lines = [
      `📋 Бронь #${r.id}`,
      '',
      `👤 ${r.guestName}`,
      `📞 ${r.guestPhone}`,
      `📅 ${formatDateRu(r.date)}`,
      `⏰ ${r.timeStart} - ${r.timeEnd}`,
      `👥 Персон: ${r.chairs.length}`,
      `🪑 ${rcGroupByDb(r.chairs)}`,
      `📌 Статус: ${statusLabel(r.status)}`,
      `🕐 Создана: ${formatCreatedAtRu(r.createdAt)}`,
      '',
      `/confirm_${r.id} | /cancel_${r.id} | /edit_${r.id} | /delete_${r.id}`,
    ];
    await ctx.reply(lines.join('\n'));
  }

  private async cmdEdit(id: number, ctx: any) {
    const r = await this.prisma.reservation.findUnique({ where: { id } });
    if (!r) { await ctx.reply(`❌ Бронь #${id} не найдена`); return; }

    const lines = [
      `✏️ Редактирование брони #${id}`,
      `${r.guestName} | ${r.timeStart}-${r.timeEnd} | ${formatDateRu(r.date)}`,
      '',
      'Что хотите изменить?',
      '',
      `/edit_${id}_date - изменить дату`,
      `/edit_${id}_time - изменить время`,
      `/edit_${id}_guests - изменить количество гостей`,
      `/edit_${id}_table - изменить стол`,
      `/edit_${id}_name - изменить имя гостя`,
      `/edit_${id}_phone - изменить телефон`,
    ];
    await ctx.reply(lines.join('\n'));
  }

  private async cmdEditField(id: number, field: EditField | 'table', userId: number, ctx: any) {
    const r = await this.prisma.reservation.findUnique({ where: { id }, include: CHAIR_INCLUDE });
    if (!r) { await ctx.reply(`❌ Бронь #${id} не найдена`); return; }

    if (field === 'table') {
      await this.showTableSelection(id, r, ctx); return;
    }

    const prompts: Record<EditField, string> = {
      date: [
        `📅 Введите новую дату для брони #${id}`,
        `Текущая дата: ${formatDateRu(r.date)}`,
        'Формат: ДД.ММ.ГГГГ (например 25.12.2024)',
      ].join('\n'),
      time: [
        `⏰ Введите новое время для брони #${id}`,
        `Текущее время: ${r.timeStart} - ${r.timeEnd}`,
        'Формат: ЧЧ:ММ-ЧЧ:ММ (например 19:00-23:00)',
      ].join('\n'),
      guests: [
        `👥 Введите новое количество гостей для брони #${id}`,
        `Текущее количество: ${r.chairs.length}`,
        'Введите число от 1 до 20',
      ].join('\n'),
      name: [
        `👤 Введите новое имя гостя для брони #${id}`,
        `Текущее имя: ${r.guestName}`,
      ].join('\n'),
      phone: [
        `📞 Введите новый телефон для брони #${id}`,
        `Текущий телефон: ${r.guestPhone}`,
      ].join('\n'),
    };

    this.sessionState.set(userId, { action: field, reservationId: id });
    await ctx.reply(prompts[field]);
  }

  private async showTableSelection(id: number, r: any, ctx: any) {
    const tables = await this.prisma.table.findMany({
      include: { chairs: true },
      orderBy: { id: 'asc' },
    });

    const otherReservedIds = await this.getReservedChairIdsExcluding(r.date, r.timeStart, r.timeEnd, id);
    const neededCount: number = r.chairs.length;

    const lines = [
      `🪑 Выберите новый стол для брони #${id}`,
      `Нужно мест: ${neededCount}`,
      '',
      `Доступные столы на ${formatDateRu(r.date)} ${r.timeStart}-${r.timeEnd}:`,
    ];

    let found = false;
    for (const t of tables) {
      const available = t.chairs.filter((c) => !c.blockedManually && !otherReservedIds.has(c.id));
      if (available.length >= neededCount) {
        found = true;
        lines.push(`/table_${id}_${t.label.toLowerCase()} - Стол ${t.label} (всего ${t.chairs.length}, свободно ${available.length})`);
      }
    }
    if (!found) lines.push('Нет доступных столов с достаточным количеством мест');

    await ctx.reply(lines.join('\n'));
  }

  private async cmdSelectTable(reservationId: number, tableLabel: string, ctx: any) {
    const r = await this.prisma.reservation.findUnique({ where: { id: reservationId }, include: CHAIR_INCLUDE });
    if (!r) { await ctx.reply(`❌ Бронь #${reservationId} не найдена`); return; }

    const table = await this.prisma.table.findFirst({
      where: { label: { mode: 'insensitive', equals: tableLabel } },
      include: { chairs: true },
    });
    if (!table) { await ctx.reply(`❌ Стол не найден`); return; }

    const neededCount: number = r.chairs.length;
    const otherReservedIds = await this.getReservedChairIdsExcluding(r.date, r.timeStart, r.timeEnd, reservationId);
    const available = table.chairs.filter((c) => !c.blockedManually && !otherReservedIds.has(c.id));

    if (available.length < neededCount) {
      await ctx.reply(`❌ Недостаточно мест. Нужно: ${neededCount}, свободно: ${available.length}`); return;
    }

    const oldPlaces = rcGroupByDb(r.chairs);
    await this.prisma.reservationChair.deleteMany({ where: { reservationId } });
    await this.prisma.reservationChair.createMany({
      data: available.slice(0, neededCount).map((c) => ({ reservationId, chairId: c.id })),
    });

    await ctx.reply(`✅ Стол изменён на Стол ${table.label}`);

    const updated = await this.prisma.reservation.findUnique({ where: { id: reservationId }, include: CHAIR_INCLUDE });
    const newPlaces = rcGroupByDb(updated!.chairs);
    await this.broadcastChange(reservationId, updated!, `🪑 Стол: ${newPlaces} (было: ${oldPlaces})`);
  }

  // ─── Session input processor ──────────────────────────────────────────────

  private async processSessionInput(userId: number, session: SessionEntry, text: string, ctx: any) {
    const { action, reservationId: id } = session;

    try {
      const r = await this.prisma.reservation.findUnique({ where: { id }, include: CHAIR_INCLUDE });
      if (!r) {
        this.sessionState.delete(userId);
        await ctx.reply(`❌ Бронь #${id} не найдена`); return;
      }

      if (action === 'date') {
        const m = text.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
        if (!m) { await ctx.reply('❌ Неверный формат. Введите дату: ДД.ММ.ГГГГ'); return; }
        const newDate = `${m[3]}-${m[2]}-${m[1]}`;
        const oldDate = r.date;
        await this.prisma.reservation.update({ where: { id }, data: { date: newDate } });
        this.sessionState.delete(userId);
        await ctx.reply(`✅ Дата изменена: ${formatDateRu(oldDate)} → ${formatDateRu(newDate)}`);
        const updated = await this.prisma.reservation.findUnique({ where: { id }, include: CHAIR_INCLUDE });
        await this.broadcastChange(id, updated!, `📅 Дата: ${formatDateRu(newDate)} (было: ${formatDateRu(oldDate)})`);
        return;
      }

      if (action === 'time') {
        const m = text.trim().match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
        if (!m) { await ctx.reply('❌ Неверный формат. Введите время: ЧЧ:ММ-ЧЧ:ММ'); return; }
        const [newStart, newEnd] = [m[1], m[2]];
        if (newStart >= newEnd) { await ctx.reply('❌ Время начала должно быть раньше окончания'); return; }

        const currentChairIds = r.chairs.map((rc: any) => rc.chairId);
        const conflict = await this.prisma.reservationChair.findFirst({
          where: {
            chairId: { in: currentChairIds },
            reservationId: { not: id },
            reservation: {
              date: r.date,
              status: { not: 'CANCELLED' as any },
              AND: [{ timeStart: { lt: newEnd } }, { timeEnd: { gt: newStart } }],
            },
          },
        });
        if (conflict) { await ctx.reply('❌ Один из стульев занят другой бронью в это время'); return; }

        const oldTime = `${r.timeStart}-${r.timeEnd}`;
        await this.prisma.reservation.update({ where: { id }, data: { timeStart: newStart, timeEnd: newEnd } });
        this.sessionState.delete(userId);
        await ctx.reply(`✅ Время изменено: ${oldTime} → ${newStart}-${newEnd}`);
        const updated = await this.prisma.reservation.findUnique({ where: { id }, include: CHAIR_INCLUDE });
        await this.broadcastChange(id, updated!, `⏰ Время: ${newStart}-${newEnd} (было: ${oldTime})`);
        return;
      }

      if (action === 'guests') {
        const newCount = parseInt(text.trim(), 10);
        if (isNaN(newCount) || newCount < 1 || newCount > 20) {
          await ctx.reply('❌ Введите число от 1 до 20'); return;
        }
        const currentCount: number = r.chairs.length;
        if (newCount === currentCount) {
          this.sessionState.delete(userId);
          await ctx.reply('Количество гостей не изменилось'); return;
        }

        if (newCount < currentCount) {
          const toRemove = r.chairs.slice(newCount);
          await this.prisma.reservationChair.deleteMany({ where: { id: { in: toRemove.map((rc: any) => rc.id) } } });
        } else {
          const tableIds = [...new Set<number>(r.chairs.map((rc: any) => rc.chair.tableId))];
          const reservedIds = await this.getReservedChairIds(r.date, r.timeStart, r.timeEnd);
          const currentChairIds = new Set<number>(r.chairs.map((rc: any) => rc.chairId));
          const need = newCount - currentCount;

          const freeChairs = await this.prisma.chair.findMany({
            where: {
              tableId: { in: tableIds },
              blockedManually: false,
              id: { notIn: [...reservedIds, ...currentChairIds] },
            },
            take: need,
          });

          if (freeChairs.length < need) {
            await ctx.reply(`❌ Недостаточно мест за столом. Можно добавить: ${freeChairs.length}`); return;
          }
          await this.prisma.reservationChair.createMany({
            data: freeChairs.map((c) => ({ reservationId: id, chairId: c.id })),
          });
        }

        this.sessionState.delete(userId);
        await ctx.reply(`✅ Количество гостей: ${currentCount} → ${newCount}`);
        const updated = await this.prisma.reservation.findUnique({ where: { id }, include: CHAIR_INCLUDE });
        await this.broadcastChange(id, updated!, `👥 Персон: ${newCount} (было: ${currentCount})`);
        return;
      }

      if (action === 'name') {
        const oldName = r.guestName;
        const newName = text.trim();
        await this.prisma.reservation.update({ where: { id }, data: { guestName: newName } });
        this.sessionState.delete(userId);
        await ctx.reply(`✅ Имя изменено: ${oldName} → ${newName}`);
        const updated = await this.prisma.reservation.findUnique({ where: { id }, include: CHAIR_INCLUDE });
        await this.broadcastChange(id, updated!, `👤 Имя: ${newName} (было: ${oldName})`);
        return;
      }

      if (action === 'phone') {
        const oldPhone = r.guestPhone;
        const newPhone = text.trim();
        await this.prisma.reservation.update({ where: { id }, data: { guestPhone: newPhone } });
        this.sessionState.delete(userId);
        await ctx.reply(`✅ Телефон изменён: ${oldPhone} → ${newPhone}`);
        const updated = await this.prisma.reservation.findUnique({ where: { id }, include: CHAIR_INCLUDE });
        await this.broadcastChange(id, updated!, `📞 Телефон: ${newPhone} (было: ${oldPhone})`);
        return;
      }
    } catch (err) {
      this.logger.error(`Session error (${action})`, err);
      this.sessionState.delete(userId);
      await ctx.reply('❌ Произошла ошибка. Попробуйте ещё раз');
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async broadcastChange(id: number, r: any, changeNote: string) {
    const message = [
      `✅ Бронь #${id} изменена`,
      '',
      `👤 ${r.guestName} | 📞 ${r.guestPhone}`,
      `📅 ${formatDateRu(r.date)}`,
      `⏰ ${r.timeStart} - ${r.timeEnd}`,
      `👥 Персон: ${r.chairs.length}`,
      `🪑 ${rcGroupByDb(r.chairs)}`,
      '',
      changeNote,
    ].join('\n');
    await this.broadcast([this.chatMain, this.chatOwner, this.chatStaff], message).catch(() => {});
  }

  private async getReservedChairIds(date: string, timeStart: string, timeEnd: string): Promise<Set<number>> {
    const rows = await this.prisma.reservationChair.findMany({
      where: {
        reservation: {
          date,
          status: { not: 'CANCELLED' as any },
          AND: [{ timeStart: { lt: timeEnd } }, { timeEnd: { gt: timeStart } }],
        },
      },
      select: { chairId: true },
    });
    return new Set(rows.map((r) => r.chairId));
  }

  private async getReservedChairIdsExcluding(
    date: string,
    timeStart: string,
    timeEnd: string,
    excludeId: number,
  ): Promise<Set<number>> {
    const rows = await this.prisma.reservationChair.findMany({
      where: {
        reservationId: { not: excludeId },
        reservation: {
          date,
          status: { not: 'CANCELLED' as any },
          AND: [{ timeStart: { lt: timeEnd } }, { timeEnd: { gt: timeStart } }],
        },
      },
      select: { chairId: true },
    });
    return new Set(rows.map((r) => r.chairId));
  }

  private toInfo(r: any): ReservationInfo {
    return {
      guestName: r.guestName,
      guestPhone: r.guestPhone,
      date: r.date,
      timeStart: r.timeStart,
      timeEnd: r.timeEnd,
      chairs: r.chairs.map((rc: any) => ({ label: rc.chair.label, tableLabel: rc.chair.table.label })),
    };
  }

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

// ─── Module-level helpers ─────────────────────────────────────────────────────

function rcGroupByLabel(chairs: { label: string; tableLabel: string }[]): string {
  const map = new Map<string, string[]>();
  for (const c of chairs) {
    if (!map.has(c.tableLabel)) map.set(c.tableLabel, []);
    map.get(c.tableLabel)!.push(c.label);
  }
  return Array.from(map.entries())
    .map(([t, ls]) => `Стол ${t} (${ls.join(', ')})`)
    .join(', ');
}

function rcGroupByDb(chairs: { chair: { label: string; table: { label: string } } }[]): string {
  const map = new Map<string, string[]>();
  for (const rc of chairs) {
    const t = rc.chair.table.label;
    if (!map.has(t)) map.set(t, []);
    map.get(t)!.push(rc.chair.label);
  }
  return Array.from(map.entries())
    .map(([t, ls]) => `Стол ${t} (${ls.join(', ')})`)
    .join(', ');
}

function statusLabel(status: string): string {
  if (status === 'CONFIRMED') return '✅ Подтверждена';
  if (status === 'CANCELLED') return '🚫 Отменена';
  return '⏳ Ожидает';
}

function pluralize(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n);
  if (abs % 10 === 1 && abs % 100 !== 11) return one;
  if (abs % 10 >= 2 && abs % 10 <= 4 && (abs % 100 < 10 || abs % 100 >= 20)) return few;
  return many;
}
