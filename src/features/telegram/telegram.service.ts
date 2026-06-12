import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Markup } from 'telegraf';
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
  private readonly session = new Map<number, SessionEntry>();

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    this.bot = new Telegraf(this.config.get<string>('TELEGRAM_BOT_TOKEN')!);
    this.chatMain  = this.config.get<string>('TELEGRAM_CHAT_ID') ?? '';
    this.chatOwner = this.config.get<string>('TELEGRAM_CHAT_ID_OWNER') ?? '';
    this.chatStaff = this.config.get<string>('TELEGRAM_CHAT_ID_STAFF') ?? '';
    this.setupHandlers();
  }

  onModuleInit() {
    if (!this.config.get('TELEGRAM_BOT_TOKEN')) return;
    this.bot.launch().catch((err) => this.logger.warn('Bot polling error', err));
    this.bot.telegram.setMyCommands([
      { command: 'bookings', description: '📋 Активные брони на сегодня' },
      { command: 'today',    description: '📅 Все брони сегодня' },
      { command: 'free',     description: '🟢 Свободные места прямо сейчас' },
      { command: 'help',     description: '❓ Справка' },
    ]).catch(() => {});
  }

  onModuleDestroy() {
    this.bot.stop('shutdown');
  }

  // ─── Public notifications ─────────────────────────────────────────────────

  async sendNewReservation(data: NewReservationData) {
    const message = [
      '🍺 Новая бронь!',
      '',
      `👤 Гость: ${data.guestName}`,
      `📞 Телефон: ${data.guestPhone}`,
      `📅 Дата: ${formatDateRu(data.date)}`,
      `⏰ Время: ${data.timeStart} — ${data.timeEnd}`,
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
      `👤 ${data.guestName}`,
      `📞 ${data.guestPhone}`,
      `📅 ${formatDateRu(data.date)}`,
      `⏰ ${data.timeStart} — ${data.timeEnd}`,
      `🪑 ${rcGroupByLabel(data.chairs)}`,
    ].join('\n');
    await this.broadcast([this.chatMain, this.chatOwner, this.chatStaff], message);
  }

  async sendConfirmation(reservationId: number, data: ReservationInfo) {
    const message = [
      `✅ Бронь #${reservationId} подтверждена`,
      '',
      `👤 ${data.guestName}`,
      `📞 ${data.guestPhone}`,
      `📅 ${formatDateRu(data.date)}`,
      `⏰ ${data.timeStart} — ${data.timeEnd}`,
      `🪑 ${rcGroupByLabel(data.chairs)}`,
    ].join('\n');
    await this.broadcast([this.chatStaff, this.chatMain], message);
  }

  // ─── Handler setup ────────────────────────────────────────────────────────

  private setupHandlers() {
    const allowed = new Set([this.chatMain, this.chatOwner, this.chatStaff].filter(Boolean));
    const guard = (ctx: any) => {
      const id = String(ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id ?? '');
      return allowed.size === 0 || allowed.has(id);
    };

    // ── Inline button callbacks ──────────────────────────────────────────────
    this.bot.on('callback_query', async (ctx) => {
      if (!guard(ctx)) { await ctx.answerCbQuery(); return; }
      const data: string = (ctx.callbackQuery as any).data ?? '';
      await ctx.answerCbQuery();

      const userId = ctx.from?.id ?? 0;
      this.session.delete(userId); // кнопка сбрасывает ожидание ввода

      const [action, idStr, extra] = data.split(':');
      const id = parseInt(idStr, 10);

      try {
        switch (action) {
          case 'confirm':      await this.cbConfirm(id, ctx); break;
          case 'cancel':       await this.cbCancel(id, ctx); break;
          case 'delete':       await this.cbDelete(id, ctx); break;
          case 'status':       await this.cbStatus(id, ctx); break;
          case 'edit':         await this.cbEditMenu(id, ctx); break;
          case 'edit_date':    await this.cbEditField(id, 'date', userId, ctx); break;
          case 'edit_time':    await this.cbEditField(id, 'time', userId, ctx); break;
          case 'edit_guests':  await this.cbEditField(id, 'guests', userId, ctx); break;
          case 'edit_name':    await this.cbEditField(id, 'name', userId, ctx); break;
          case 'edit_phone':   await this.cbEditField(id, 'phone', userId, ctx); break;
          case 'edit_table':   await this.cbEditTable(id, ctx); break;
          case 'select_table': await this.cbSelectTable(id, extra, ctx); break;
        }
      } catch (err) {
        this.logger.error(`Callback error (${action})`, err);
        await ctx.reply('❌ Произошла ошибка, попробуйте ещё раз').catch(() => {});
      }
    });

    // ── Text messages ────────────────────────────────────────────────────────
    this.bot.on('text', async (ctx) => {
      if (!guard(ctx)) return;
      const text: string = ctx.message.text;
      const userId = ctx.from?.id ?? 0;

      // Ожидание ввода (дата / время / имя / телефон / кол-во гостей)
      const s = this.session.get(userId);
      if (s && !text.startsWith('/')) {
        await this.processInput(userId, s, text, ctx);
        return;
      }
      if (s) this.session.delete(userId);

      if (text === '/bookings' || text === '/start') { await this.cmdBookings(ctx); return; }
      if (text === '/today')                          { await this.cmdToday(ctx); return; }
      if (text === '/free')                           { await this.cmdFree(ctx); return; }
      if (text === '/help')                           { await this.cmdHelp(ctx); return; }
    });
  }

  // ─── Text commands ────────────────────────────────────────────────────────

  private async cmdHelp(ctx: any) {
    await ctx.reply(
      [
        '🍺 Управление бронями Beer Garage',
        '',
        'Используйте кнопки меню:',
        '📋 /bookings — брони на сегодня',
        '📅 /today — все брони сегодня',
        '🟢 /free — свободные места сейчас',
        '',
        'У каждой брони есть кнопки для управления.',
        'Нажмите нужную кнопку — бот спросит что именно изменить.',
      ].join('\n'),
    );
  }

  private async cmdBookings(ctx: any) {
    const today = todayStr();
    const reservations = await this.prisma.reservation.findMany({
      where: { date: today, status: { not: 'CANCELLED' as any } },
      include: CHAIR_INCLUDE,
      orderBy: { timeStart: 'asc' },
    });

    if (!reservations.length) {
      await ctx.reply('📋 Активных броней на сегодня нет');
      return;
    }

    await ctx.reply(`📋 Активные брони на сегодня — ${formatDateRu(today)}:`);
    for (const r of reservations) {
      await ctx.reply(bookingText(r), mkActionKeyboard(r.id, r.status));
    }
  }

  private async cmdToday(ctx: any) {
    const today = todayStr();
    const reservations = await this.prisma.reservation.findMany({
      where: { date: today },
      include: CHAIR_INCLUDE,
      orderBy: { timeStart: 'asc' },
    });

    if (!reservations.length) {
      await ctx.reply(`📅 Броней на ${formatDateRu(today)} нет`);
      return;
    }

    let pending = 0, confirmed = 0, cancelled = 0;
    const lines = [`📅 Брони на сегодня — ${formatDateRu(today)}`, ''];
    for (const r of reservations) {
      if (r.status === 'PENDING') pending++;
      else if (r.status === 'CONFIRMED') confirmed++;
      else cancelled++;
      const emoji = r.status === 'CONFIRMED' ? '✅' : r.status === 'CANCELLED' ? '❌' : '⏳';
      const tables = [...new Set(r.chairs.map((rc: any) => `Стол ${rc.chair.table.label}`))].join(', ');
      lines.push(`${emoji} #${r.id} ${r.guestName} | ${r.timeStart}–${r.timeEnd} | ${tables} | ${r.chairs.length} чел`);
    }
    lines.push('', `Всего: ${reservations.length} | Ожидает: ${pending} | Подтверждено: ${confirmed} | Отменено: ${cancelled}`);
    await ctx.reply(lines.join('\n'));
  }

  private async cmdFree(ctx: any) {
    const today = todayStr();
    const now = currentTimeStr();
    const tables = await this.prisma.table.findMany({ include: { chairs: true }, orderBy: { id: 'asc' } });
    const reservedIds = await this.getReservedIds(today, now, now);

    const lines = ['🟢 Свободные места прямо сейчас:', ''];
    let anyFree = false;
    for (const t of tables) {
      const free = t.chairs.filter((c) => !c.blockedManually && !reservedIds.has(c.id)).length;
      if (free > 0) {
        anyFree = true;
        lines.push(`Стол ${t.label} — ${free} из ${t.chairs.length} ${pluralize(free, 'место', 'места', 'мест')} свободно`);
      }
    }
    await ctx.reply(anyFree ? lines.join('\n') : '🔴 Свободных мест прямо сейчас нет');
  }

  // ─── Inline-button callbacks ──────────────────────────────────────────────

  private async cbConfirm(id: number, ctx: any) {
    const r = await this.prisma.reservation.findUnique({ where: { id }, include: CHAIR_INCLUDE });
    if (!r) { await ctx.reply(`❌ Бронь #${id} не найдена`); return; }
    if (r.status === 'CONFIRMED') { await ctx.reply(`Бронь #${id} уже подтверждена`); return; }
    if (r.status === 'CANCELLED') { await ctx.reply(`❌ Бронь #${id} отменена — невозможно подтвердить`); return; }

    await this.prisma.reservation.update({ where: { id }, data: { status: 'CONFIRMED' } });
    const updated = await this.prisma.reservation.findUnique({ where: { id }, include: CHAIR_INCLUDE });
    await ctx.editMessageText(bookingText(updated!), mkActionKeyboard(id, 'CONFIRMED')).catch(() => {});
    await this.sendConfirmation(id, this.toInfo(updated!)).catch(() => {});
  }

  private async cbCancel(id: number, ctx: any) {
    const r = await this.prisma.reservation.findUnique({ where: { id }, include: CHAIR_INCLUDE });
    if (!r) { await ctx.reply(`❌ Бронь #${id} не найдена`); return; }
    if (r.status === 'CANCELLED') { await ctx.reply(`Бронь #${id} уже отменена`); return; }

    await this.prisma.reservation.update({ where: { id }, data: { status: 'CANCELLED' } });
    const updated = await this.prisma.reservation.findUnique({ where: { id }, include: CHAIR_INCLUDE });
    await ctx.editMessageText(bookingText(updated!), mkActionKeyboard(id, 'CANCELLED')).catch(() => {});
    await this.sendCancellation(id, this.toInfo(r)).catch(() => {});
  }

  private async cbDelete(id: number, ctx: any) {
    const r = await this.prisma.reservation.findUnique({ where: { id } });
    if (!r) { await ctx.reply(`❌ Бронь #${id} не найдена`); return; }
    if (r.status !== 'CANCELLED') {
      await ctx.reply(`❌ Удалить можно только отменённую бронь\nТекущий статус: ${statusLabel(r.status)}`);
      return;
    }
    await this.prisma.reservationChair.deleteMany({ where: { reservationId: id } });
    await this.prisma.reservation.delete({ where: { id } });
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply(`🗑 Бронь #${id} удалена`);
    await this.broadcast([this.chatMain, this.chatOwner, this.chatStaff], `🗑 Бронь #${id} удалена`).catch(() => {});
  }

  private async cbStatus(id: number, ctx: any) {
    const r = await this.prisma.reservation.findUnique({ where: { id }, include: CHAIR_INCLUDE });
    if (!r) { await ctx.reply(`❌ Бронь #${id} не найдена`); return; }
    const text = bookingText(r) + `\n🕐 Создана: ${formatCreatedAtRu(r.createdAt)}`;
    await ctx.editMessageText(text, mkActionKeyboard(id, r.status)).catch(async () => {
      await ctx.reply(text, mkActionKeyboard(id, r.status));
    });
  }

  private async cbEditMenu(id: number, ctx: any) {
    const r = await this.prisma.reservation.findUnique({ where: { id } });
    if (!r) { await ctx.reply(`❌ Бронь #${id} не найдена`); return; }
    const header = `✏️ Редактирование брони #${id}\n${r.guestName} | ${r.timeStart}–${r.timeEnd} | ${formatDateRu(r.date)}\n\nЧто изменить?`;
    await ctx.editMessageText(header, mkEditKeyboard(id)).catch(async () => {
      await ctx.reply(header, mkEditKeyboard(id));
    });
  }

  private async cbEditField(id: number, field: EditField, userId: number, ctx: any) {
    const r = await this.prisma.reservation.findUnique({ where: { id }, include: CHAIR_INCLUDE });
    if (!r) { await ctx.reply(`❌ Бронь #${id} не найдена`); return; }

    let guestsPrompt = '';
    if (field === 'guests') {
      const cur: number = r.chairs.length;
      const extraFree = await this.countFreeChairsAtTables(r, id);
      const max = cur + extraFree;
      if (extraFree === 0) {
        guestsPrompt = [
          `👥 Изменение количества гостей для брони #${id}`,
          `Сейчас: ${cur}`,
          ``,
          `➕ Добавить гостей нельзя — за этим столом нет свободных мест на это время.`,
          `Можно уменьшить количество (минимум 1) или пересадить за другой стол: нажмите кнопку 🪑 Стол`,
        ].join('\n');
      } else {
        guestsPrompt = [
          `👥 Введите количество гостей для брони #${id}`,
          `Сейчас: ${cur} | Максимум за этим столом: ${max}`,
          ``,
          `Введите число от 1 до ${max}`,
          `Если нужно больше — используйте кнопку 🪑 Стол`,
        ].join('\n');
      }
    }

    const prompts: Record<EditField, string> = {
      date:   `📅 Введите новую дату для брони #${id}\nТекущая: ${formatDateRu(r.date)}\nФормат: ДД.ММ.ГГГГ`,
      time:   `⏰ Введите новое время для брони #${id}\nТекущее: ${r.timeStart}–${r.timeEnd}\nФормат: ЧЧ:ММ–ЧЧ:ММ`,
      guests: guestsPrompt,
      name:   `👤 Введите новое имя гостя для брони #${id}\nСейчас: ${r.guestName}`,
      phone:  `📞 Введите новый телефон для брони #${id}\nСейчас: ${r.guestPhone}`,
    };

    this.session.set(userId, { action: field, reservationId: id });
    await ctx.reply(prompts[field]);
  }

  private async cbEditTable(id: number, ctx: any) {
    const r = await this.prisma.reservation.findUnique({ where: { id }, include: CHAIR_INCLUDE });
    if (!r) { await ctx.reply(`❌ Бронь #${id} не найдена`); return; }

    const tables = await this.prisma.table.findMany({ include: { chairs: true }, orderBy: { id: 'asc' } });
    const otherReserved = await this.getReservedIdsExcluding(r.date, r.timeStart, r.timeEnd, id);
    const needed: number = r.chairs.length;

    const rows = tables
      .map((t) => {
        const free = t.chairs.filter((c) => !c.blockedManually && !otherReserved.has(c.id)).length;
        return { t, free };
      })
      .filter(({ free }) => free >= needed)
      .map(({ t, free }) => [
        Markup.button.callback(
          `Стол ${t.label} — ${free} своб.`,
          `select_table:${id}:${t.label.toLowerCase()}`,
        ),
      ]);

    if (!rows.length) {
      await ctx.reply(`❌ Нет столов с ${needed} свободными местами на это время`);
      return;
    }

    rows.push([Markup.button.callback('◀️ Назад', `edit:${id}`)]);

    await ctx.reply(
      `🪑 Выберите стол для брони #${id}\nНужно мест: ${needed} | ${formatDateRu(r.date)} ${r.timeStart}–${r.timeEnd}`,
      Markup.inlineKeyboard(rows),
    );
  }

  private async cbSelectTable(reservationId: number, tableLabel: string, ctx: any) {
    const r = await this.prisma.reservation.findUnique({ where: { id: reservationId }, include: CHAIR_INCLUDE });
    if (!r) { await ctx.reply(`❌ Бронь #${reservationId} не найдена`); return; }

    const table = await this.prisma.table.findFirst({
      where: { label: { mode: 'insensitive', equals: tableLabel } },
      include: { chairs: true },
    });
    if (!table) { await ctx.reply('❌ Стол не найден'); return; }

    const otherReserved = await this.getReservedIdsExcluding(r.date, r.timeStart, r.timeEnd, reservationId);
    const needed: number = r.chairs.length;
    const available = table.chairs.filter((c) => !c.blockedManually && !otherReserved.has(c.id));

    if (available.length < needed) {
      await ctx.reply(`❌ Недостаточно мест: нужно ${needed}, свободно ${available.length}`);
      return;
    }

    const oldPlaces = rcGroupByDb(r.chairs);
    await this.prisma.reservationChair.deleteMany({ where: { reservationId } });
    await this.prisma.reservationChair.createMany({
      data: available.slice(0, needed).map((c) => ({ reservationId, chairId: c.id })),
    });

    const updated = await this.prisma.reservation.findUnique({ where: { id: reservationId }, include: CHAIR_INCLUDE });
    await ctx.reply(bookingText(updated!), mkActionKeyboard(reservationId, updated!.status));
    await this.broadcastChange(reservationId, updated!, `🪑 Стол: ${rcGroupByDb(updated!.chairs)} (было: ${oldPlaces})`);
  }

  // ─── Session text input processor ────────────────────────────────────────

  private async processInput(userId: number, s: SessionEntry, text: string, ctx: any) {
    const { action, reservationId: id } = s;

    const r = await this.prisma.reservation.findUnique({ where: { id }, include: CHAIR_INCLUDE });
    if (!r) { this.session.delete(userId); await ctx.reply(`❌ Бронь #${id} не найдена`); return; }

    try {
      if (action === 'date') {
        const m = text.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
        if (!m) { await ctx.reply('❌ Неверный формат. Пример: 25.12.2024'); return; }
        const newDate = `${m[3]}-${m[2]}-${m[1]}`;
        const old = r.date;
        await this.prisma.reservation.update({ where: { id }, data: { date: newDate } });
        this.session.delete(userId);
        await ctx.reply(`✅ Дата изменена: ${formatDateRu(old)} → ${formatDateRu(newDate)}`);
        const updated = await this.prisma.reservation.findUnique({ where: { id }, include: CHAIR_INCLUDE });
        await ctx.reply(bookingText(updated!), mkActionKeyboard(id, updated!.status));
        await this.broadcastChange(id, updated!, `📅 Дата: ${formatDateRu(newDate)} (было: ${formatDateRu(old)})`);
        return;
      }

      if (action === 'time') {
        const m = text.trim().match(/^(\d{2}:\d{2})[–\-](\d{2}:\d{2})$/);
        if (!m) { await ctx.reply('❌ Неверный формат. Пример: 19:00–23:00'); return; }
        const [newStart, newEnd] = [m[1], m[2]];
        if (newStart >= newEnd) { await ctx.reply('❌ Начало должно быть раньше окончания'); return; }
        const conflict = await this.prisma.reservationChair.findFirst({
          where: {
            chairId: { in: r.chairs.map((rc: any) => rc.chairId) },
            reservationId: { not: id },
            reservation: {
              date:      r.date,
              status:    { not: 'CANCELLED' as any },
              timeStart: { lt: newEnd },
              timeEnd:   { gt: newStart },
            },
          },
        });
        if (conflict) { await ctx.reply('❌ Один из стульев занят другой бронью в это время'); return; }
        const old = `${r.timeStart}–${r.timeEnd}`;
        await this.prisma.reservation.update({ where: { id }, data: { timeStart: newStart, timeEnd: newEnd } });
        this.session.delete(userId);
        await ctx.reply(`✅ Время изменено: ${old} → ${newStart}–${newEnd}`);
        const updated = await this.prisma.reservation.findUnique({ where: { id }, include: CHAIR_INCLUDE });
        await ctx.reply(bookingText(updated!), mkActionKeyboard(id, updated!.status));
        await this.broadcastChange(id, updated!, `⏰ Время: ${newStart}–${newEnd} (было: ${old})`);
        return;
      }

      if (action === 'guests') {
        const n = parseInt(text.trim(), 10);
        if (isNaN(n) || n < 1) { await ctx.reply('❌ Введите целое число от 1 и выше'); return; }
        const cur: number = r.chairs.length;
        if (n === cur) { this.session.delete(userId); await ctx.reply('Количество не изменилось'); return; }

        if (n < cur) {
          const toRemove = r.chairs.slice(n);
          await this.prisma.reservationChair.deleteMany({ where: { id: { in: toRemove.map((rc: any) => rc.id) } } });
        } else {
          const extraFree = await this.countFreeChairsAtTables(r, id);
          const max = cur + extraFree;
          if (n > max) {
            if (extraFree === 0) {
              await ctx.reply(
                `❌ За этим столом нет свободных мест на это время.\n` +
                `Сейчас: ${cur} гостей — это максимум.\n` +
                `Чтобы добавить больше — пересадите за другой стол (кнопка 🪑 Стол).`
              );
            } else {
              await ctx.reply(
                `❌ За этим столом можно максимум ${max} гостей (сейчас ${cur} + свободно ещё ${extraFree}).\n` +
                `Введите число от 1 до ${max}, или пересадите за другой стол (кнопка 🪑 Стол).`
              );
            }
            return;
          }
          const tableIds = [...new Set<number>(r.chairs.map((rc: any) => rc.chair.tableId))];
          const reserved = await this.getReservedIds(r.date, r.timeStart, r.timeEnd);
          const current = new Set<number>(r.chairs.map((rc: any) => rc.chairId));
          const free = await this.prisma.chair.findMany({
            where: { tableId: { in: tableIds }, blockedManually: false, id: { notIn: [...reserved, ...current] } },
            take: n - cur,
          });
          await this.prisma.reservationChair.createMany({ data: free.map((c) => ({ reservationId: id, chairId: c.id })) });
        }

        this.session.delete(userId);
        await ctx.reply(`✅ Гостей: ${cur} → ${n}`);
        const updated = await this.prisma.reservation.findUnique({ where: { id }, include: CHAIR_INCLUDE });
        await ctx.reply(bookingText(updated!), mkActionKeyboard(id, updated!.status));
        await this.broadcastChange(id, updated!, `👥 Персон: ${n} (было: ${cur})`);
        return;
      }

      if (action === 'name') {
        const old = r.guestName;
        const val = text.trim();
        await this.prisma.reservation.update({ where: { id }, data: { guestName: val } });
        this.session.delete(userId);
        await ctx.reply(`✅ Имя: ${old} → ${val}`);
        const updated = await this.prisma.reservation.findUnique({ where: { id }, include: CHAIR_INCLUDE });
        await ctx.reply(bookingText(updated!), mkActionKeyboard(id, updated!.status));
        await this.broadcastChange(id, updated!, `👤 Имя: ${val} (было: ${old})`);
        return;
      }

      if (action === 'phone') {
        const old = r.guestPhone;
        const val = text.trim();
        await this.prisma.reservation.update({ where: { id }, data: { guestPhone: val } });
        this.session.delete(userId);
        await ctx.reply(`✅ Телефон: ${old} → ${val}`);
        const updated = await this.prisma.reservation.findUnique({ where: { id }, include: CHAIR_INCLUDE });
        await ctx.reply(bookingText(updated!), mkActionKeyboard(id, updated!.status));
        await this.broadcastChange(id, updated!, `📞 Телефон: ${val} (было: ${old})`);
        return;
      }
    } catch (err) {
      this.logger.error(`Input error (${action})`, err);
      this.session.delete(userId);
      await ctx.reply('❌ Произошла ошибка, попробуйте ещё раз');
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async countFreeChairsAtTables(r: any, excludeReservationId: number): Promise<number> {
    const tableIds = [...new Set<number>(r.chairs.map((rc: any) => rc.chair.tableId))];
    const reserved = await this.getReservedIdsExcluding(r.date, r.timeStart, r.timeEnd, excludeReservationId);
    const currentChairIds = r.chairs.map((rc: any) => rc.chairId);
    return this.prisma.chair.count({
      where: {
        tableId: { in: tableIds },
        blockedManually: false,
        id: { notIn: [...reserved, ...currentChairIds] },
      },
    });
  }

  private async broadcastChange(id: number, r: any, changeNote: string) {
    const msg = [
      `✅ Бронь #${id} изменена`,
      '',
      `👤 ${r.guestName} | 📞 ${r.guestPhone}`,
      `📅 ${formatDateRu(r.date)}`,
      `⏰ ${r.timeStart} — ${r.timeEnd}`,
      `👥 Персон: ${r.chairs.length}`,
      `🪑 ${rcGroupByDb(r.chairs)}`,
      '',
      changeNote,
    ].join('\n');
    await this.broadcast([this.chatMain, this.chatOwner, this.chatStaff], msg).catch(() => {});
  }

  private async getReservedIds(date: string, ts: string, te: string): Promise<Set<number>> {
    const rows = await this.prisma.reservationChair.findMany({
      where: {
        reservation: {
          date,
          status:    { not: 'CANCELLED' as any },
          timeStart: { lt: te },
          timeEnd:   { gt: ts },
        },
      },
      select: { chairId: true },
    });
    return new Set(rows.map((r) => r.chairId));
  }

  private async getReservedIdsExcluding(date: string, ts: string, te: string, excludeId: number): Promise<Set<number>> {
    const rows = await this.prisma.reservationChair.findMany({
      where: {
        reservationId: { not: excludeId },
        reservation: {
          date,
          status:    { not: 'CANCELLED' as any },
          timeStart: { lt: te },
          timeEnd:   { gt: ts },
        },
      },
      select: { chairId: true },
    });
    return new Set(rows.map((r) => r.chairId));
  }

  private toInfo(r: any): ReservationInfo {
    return {
      guestName: r.guestName, guestPhone: r.guestPhone,
      date: r.date, timeStart: r.timeStart, timeEnd: r.timeEnd,
      chairs: r.chairs.map((rc: any) => ({ label: rc.chair.label, tableLabel: rc.chair.table.label })),
    };
  }

  private async broadcast(chatIds: string[], message: string) {
    const targets = [...new Set(chatIds.filter(Boolean))];
    await Promise.allSettled(
      targets.map((id) => this.bot.telegram.sendMessage(id, message).catch((err) => {
        this.logger.error(`Failed to send to ${id}`, err);
      })),
    );
  }
}

// ─── Module-level helpers ─────────────────────────────────────────────────────

function bookingText(r: any): string {
  return [
    `🆔 Бронь #${r.id}`,
    `👤 ${r.guestName} | 📞 ${r.guestPhone}`,
    `📅 ${formatDateRu(r.date)}`,
    `⏰ ${r.timeStart} — ${r.timeEnd}`,
    `👥 Персон: ${r.chairs.length}`,
    `🪑 ${rcGroupByDb(r.chairs)}`,
    `📌 ${statusLabel(r.status)}`,
  ].join('\n');
}

function mkActionKeyboard(id: number, status: string) {
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  if (status === 'PENDING') {
    rows.push([
      Markup.button.callback('✅ Подтвердить', `confirm:${id}`),
      Markup.button.callback('🚫 Отменить', `cancel:${id}`),
    ]);
  } else if (status === 'CONFIRMED') {
    rows.push([Markup.button.callback('🚫 Отменить', `cancel:${id}`)]);
  }
  rows.push([
    Markup.button.callback('✏️ Редактировать', `edit:${id}`),
    Markup.button.callback('🗑 Удалить', `delete:${id}`),
  ]);
  return Markup.inlineKeyboard(rows);
}

function mkEditKeyboard(id: number) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📅 Дата',    `edit_date:${id}`),   Markup.button.callback('⏰ Время',   `edit_time:${id}`)],
    [Markup.button.callback('👥 Гостей',  `edit_guests:${id}`), Markup.button.callback('🪑 Стол',    `edit_table:${id}`)],
    [Markup.button.callback('👤 Имя',     `edit_name:${id}`),   Markup.button.callback('📞 Телефон', `edit_phone:${id}`)],
    [Markup.button.callback('◀️ Назад к брони', `status:${id}`)],
  ]);
}

function rcGroupByLabel(chairs: { label: string; tableLabel: string }[]): string {
  const map = new Map<string, string[]>();
  for (const c of chairs) {
    if (!map.has(c.tableLabel)) map.set(c.tableLabel, []);
    map.get(c.tableLabel)!.push(c.label);
  }
  return Array.from(map.entries()).map(([t, ls]) => `Стол ${t} (${ls.join(', ')})`).join(', ');
}

function rcGroupByDb(chairs: { chair: { label: string; table: { label: string } } }[]): string {
  const map = new Map<string, string[]>();
  for (const rc of chairs) {
    const t = rc.chair.table.label;
    if (!map.has(t)) map.set(t, []);
    map.get(t)!.push(rc.chair.label);
  }
  return Array.from(map.entries()).map(([t, ls]) => `Стол ${t} (${ls.join(', ')})`).join(', ');
}

function statusLabel(status: string): string {
  if (status === 'CONFIRMED') return '✅ Подтверждена';
  if (status === 'CANCELLED') return '🚫 Отменена';
  return '⏳ Ожидает подтверждения';
}

function pluralize(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n);
  if (a % 10 === 1 && a % 100 !== 11) return one;
  if (a % 10 >= 2 && a % 10 <= 4 && (a % 100 < 10 || a % 100 >= 20)) return few;
  return many;
}
