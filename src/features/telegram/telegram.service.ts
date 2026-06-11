import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf } from 'telegraf';

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
export class TelegramService {
  private readonly bot: Telegraf;
  private readonly chatMain: string;
  private readonly chatOwner: string;
  private readonly chatStaff: string;
  private readonly logger = new Logger(TelegramService.name);

  constructor(private config: ConfigService) {
    this.bot = new Telegraf(this.config.get<string>('TELEGRAM_BOT_TOKEN')!);
    this.chatMain  = this.config.get<string>('TELEGRAM_CHAT_ID') ?? '';
    this.chatOwner = this.config.get<string>('TELEGRAM_CHAT_ID_OWNER') ?? '';
    this.chatStaff = this.config.get<string>('TELEGRAM_CHAT_ID_STAFF') ?? '';
  }

  async sendNewReservation(data: NewReservationData) {
    const { guestName, guestPhone, date, timeStart, timeEnd, chairs, freeChairsCount } = data;
    const chairsList = chairs.map((c) => `${c.label} (Стол ${c.tableLabel})`).join(', ');

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

    await this.broadcast([this.chatMain, this.chatOwner, this.chatStaff], message);
  }

  async sendCancellation(reservationId: number, data: ReservationInfo) {
    const { guestName, guestPhone, date, timeStart, timeEnd, chairs } = data;
    const chairsList = chairs.map((c) => `${c.label} (Стол ${c.tableLabel})`).join(', ');

    const message = [
      `🚫 Бронь #${reservationId} отменена`,
      '',
      `Гость: ${guestName}`,
      `Телефон: ${guestPhone}`,
      `Дата: ${date}`,
      `Время: ${timeStart} - ${timeEnd}`,
      `Места: ${chairsList}`,
    ].join('\n');

    await this.broadcast([this.chatMain, this.chatOwner, this.chatStaff], message);
  }

  async sendConfirmation(reservationId: number, data: ReservationInfo) {
    const { guestName, guestPhone, date, timeStart, timeEnd, chairs } = data;
    const chairsList = chairs.map((c) => `${c.label} (Стол ${c.tableLabel})`).join(', ');

    const message = [
      `✅ Бронь #${reservationId} подтверждена`,
      '',
      `Гость: ${guestName}`,
      `Телефон: ${guestPhone}`,
      `Дата: ${date}`,
      `Время: ${timeStart} - ${timeEnd}`,
      `Места: ${chairsList}`,
    ].join('\n');

    await this.broadcast([this.chatStaff, this.chatMain], message);
  }

  async sendBotChange(reservationId: number, description: string) {
    const message = `🤖 Изменение брони #${reservationId}\n\n${description}`;
    await this.broadcast([this.chatMain, this.chatOwner, this.chatStaff], message);
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
