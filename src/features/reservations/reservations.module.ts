import { Module } from '@nestjs/common';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { TelegramModule } from '../telegram/telegram.module';
import { TablesModule } from '../tables/tables.module';

@Module({
  imports: [TelegramModule, TablesModule],
  controllers: [ReservationsController],
  providers: [ReservationsService],
})
export class ReservationsModule {}
