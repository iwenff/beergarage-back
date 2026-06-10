import { IsString, IsInt, IsNumber, Min } from 'class-validator';

export class CreateTableDto {
  @IsString()
  label: string;

  @IsInt()
  @Min(1)
  capacity: number;

  @IsNumber()
  positionX: number;

  @IsNumber()
  positionY: number;
}
