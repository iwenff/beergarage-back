import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { UpdateChairsDto } from './dto/update-chairs.dto';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('STAFF', 'ADMIN')
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get('reservations')
  getReservations(@Query('date') date?: string, @Query('status') status?: string) {
    return this.adminService.getReservations(date, status);
  }

  @Patch('reservations/:id/confirm')
  confirm(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.confirmReservation(id);
  }

  @Patch('reservations/:id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.cancelReservation(id);
  }

  @Patch('reservations/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateReservationDto) {
    return this.adminService.updateReservation(id, dto);
  }

  @Delete('reservations/:id')
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.deleteReservation(id);
  }

  @Patch('tables/:tableId/chairs')
  updateChairs(
    @Param('tableId', ParseIntPipe) tableId: number,
    @Body() dto: UpdateChairsDto,
  ) {
    return this.adminService.updateChairs(tableId, dto);
  }
}
