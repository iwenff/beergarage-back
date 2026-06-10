import { IsInt, IsDateString, IsString, IsPhoneNumber, Min, Matches } from 'class-validator';

export class CreateReservationDto {
  @IsInt()
  tableId: number;

  @IsDateString()
  date: string;

  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'timeStart must be HH:MM' })
  timeStart: string;

  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'timeEnd must be HH:MM' })
  timeEnd: string;

  @IsInt()
  @Min(1)
  guestsCount: number;

  @IsString()
  guestName: string;

  @IsString()
  guestPhone: string;
}
