import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf } from 'telegraf';

type NotificationData = {
  guestName: string;
  guestPhone: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  chairs: { label: string; tableLabel: string }[];
  freeChairsCount: number;
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
    const { guestName, guestPhone, date, timeStart, timeEnd, chairs, freeChairsCount } = data;

    const chairsList = chairs
      .map((c) => `${c.label} (Стол ${c.tableLabel})`)
      .join(', ');

    const message = [
      '🍺 Новая бронь!',
      '',
      `Гость: ${guestName}`,
      `Телефон: ${guestPhone}`,
      `Дата: ${date}`,
      `Время: ${timeStart} - ${timeEnd}`,
      `Места: ${chairsList}`,
      '',
      `Свободных мест осталось: ${freeChairsCount}`,
    ].join('\n');

    try {
      await this.bot.telegram.sendMessage(this.chatId, message);
    } catch (err) {
      this.logger.error('Telegram notification failed', err);
    }
  }
}
