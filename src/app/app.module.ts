import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../shared/prisma/prisma.module';
import { AuthModule } from '../features/auth/auth.module';
import { TablesModule } from '../features/tables/tables.module';
import { ReservationsModule } from '../features/reservations/reservations.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    TablesModule,
    ReservationsModule,
  ],
})
export class AppModule {}
