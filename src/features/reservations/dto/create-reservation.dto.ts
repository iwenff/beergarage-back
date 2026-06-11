import { IsArray, IsDateString, IsInt, IsOptional, IsString, ArrayMinSize, Matches } from 'class-validator';

export class CreateReservationDto {
  @IsArray()
  @IsInt({ each: true })
  @ArrayMinSize(1)
  chairIds: number[];

  @IsDateString()
  date: string;

  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'timeStart must be HH:MM' })
  timeStart: string;

  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'timeEnd must be HH:MM' })
  timeEnd: string;

  @IsOptional()
  @IsString()
  guestName?: string;

  @IsOptional()
  @IsString()
  guestPhone?: string;
}
