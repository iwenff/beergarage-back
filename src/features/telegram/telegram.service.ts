import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf } from 'telegraf';

type NotificationData = {
  guestName: string;
  guestPhone: string;
  date: Date;
  timeStart: string;
  timeEnd: string;
  chairs: { label: string; tableLabel: string }[];
};

@Injectable()
export class TelegramService {
  private readonly bot: Telegraf;
  private readonly chatId: string;
  private readonly logger = new Logger(TelegramService.name);

  constructor(private config: ConfigService) {
    this.bot = new Telegraf(this.config.get<string>('TELEGRAM_BOT_TOKEN')!);
    this.chatId = this.config.get<string>('TELEGRAM_CHAT_ID')!;
  }

  async sendReservationNotification(data: NotificationData) {
    const { guestName, guestPhone, date, timeStart, timeEnd, chairs } = data;

    const dateStr = date.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });

    const tableMap = new Map<string, string[]>();
    for (const c of chairs) {
      if (!tableMap.has(c.tableLabel)) tableMap.set(c.tableLabel, []);
      tableMap.get(c.tableLabel)!.push(c.label);
    }

    const chairsStr = Array.from(tableMap.entries())
      .map(([table, labels]) => `  Стол ${table}: стулья ${labels.join(', ')}`)
      .join('\n');

    const message = [
      '🍺 Новая бронь',
      '',
      `👤 Гость: ${guestName}`,
      `📞 Телефон: ${guestPhone}`,
      `📅 Дата: ${dateStr}`,
      `🕐 Время: ${timeStart} — ${timeEnd}`,
      '',
      '💺 Забронированные места:',
      chairsStr,
    ].join('\n');

    try {
      await this.bot.telegram.sendMessage(this.chatId, message);
    } catch (err) {
      this.logger.error('Telegram notification failed', err);
    }
  }
}
