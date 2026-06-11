import { IsOptional, IsString, Matches } from 'class-validator';

export class UpdateReservationDto {
  @IsOptional()
  @IsString()
  guestName?: string;

  @IsOptional()
  @IsString()
  guestPhone?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'timeStart must be HH:MM' })
  timeStart?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'timeEnd must be HH:MM' })
  timeEnd?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
