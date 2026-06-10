import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  Request,
  ParseIntPipe,
} from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';

@Controller('reservations')
@UseGuards(JwtAuthGuard)
export class ReservationsController {
  constructor(private reservationsService: ReservationsService) {}

  @Post()
  create(@Body() dto: CreateReservationDto, @Request() req) {
    return this.reservationsService.create(req.user.id, dto);
  }

  @Get('my')
  getMyReservations(@Request() req) {
    return this.reservationsService.findByUser(req.user.id);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('STAFF', 'ADMIN')
  getAll() {
    return this.reservationsService.findAll();
  }

  @Patch(':id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.reservationsService.cancel(id, req.user.id, req.user.role);
  }

  @Patch(':id/confirm')
  @UseGuards(RolesGuard)
  @Roles('STAFF', 'ADMIN')
  confirm(@Param('id', ParseIntPipe) id: number) {
    return this.reservationsService.confirm(id);
  }
}
