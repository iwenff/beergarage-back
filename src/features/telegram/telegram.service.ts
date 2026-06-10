import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf } from 'telegraf';

type NotificationData = {
  tableLabel: string;
  date: Date;
  timeStart: string;
  timeEnd: string;
  guestsCount: number;
  clientName: string;
  clientPhone: string;
  freeTables: { label: string; capacity: number }[];
};

@Injectable()
export class TelegramService {
  private readonly bot: Telegraf;
  private readonly chatId: string;
  private readonly logger = new Logger(TelegramService.name);

  constructor(private config: ConfigService) {
    this.bot = new Telegraf(this.config.get<string>('TELEGRAM_BOT_TOKEN'));
    this.chatId = this.config.get<string>('TELEGRAM_CHAT_ID');
  }

  async sendReservationNotification(data: NotificationData) {
    const { tableLabel, date, timeStart, timeEnd, guestsCount, clientName, clientPhone, freeTables } = data;

    const dateStr = date.toISOString().split('T')[0];
    const freeList = freeTables.length
      ? freeTables.map((t) => `  • ${t.label} (${t.capacity} seats)`).join('\n')
      : '  none';

    const message = [
      `New Reservation`,
      ``,
      `Table: ${tableLabel}`,
      `Date: ${dateStr}`,
      `Time: ${timeStart} — ${timeEnd}`,
      `Guests: ${guestsCount}`,
      `Client: ${clientName}`,
      `Phone: ${clientPhone}`,
      ``,
      `Free tables for this slot:`,
      freeList,
    ].join('\n');

    try {
      await this.bot.telegram.sendMessage(this.chatId, message);
    } catch (err) {
      this.logger.error('Telegram notification failed', err);
    }
  }
}
