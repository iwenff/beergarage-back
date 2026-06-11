import { IsString, IsInt, Min } from 'class-validator';

export class CreateTableDto {
  @IsString()
  label: string;

  @IsInt()
  @Min(1)
  capacity: number;

  @IsInt()
  positionX: number;

  @IsInt()
  positionY: number;
}
