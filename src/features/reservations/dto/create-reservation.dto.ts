import { IsArray, IsInt, IsString, ArrayMinSize, Matches } from 'class-validator';

export class CreateReservationDto {
  @IsArray()
  @IsInt({ each: true })
  @ArrayMinSize(1)
  chairIds: number[];

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date: string;

  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'timeStart must be HH:MM' })
  timeStart: string;

  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'timeEnd must be HH:MM' })
  timeEnd: string;

  @IsString()
  guestName: string;

  @IsString()
  guestPhone: string;
}
