import { IsString, IsInt } from 'class-validator';

export class CreateTableDto {
  @IsString()
  label: string;

  @IsInt()
  positionX: number;

  @IsInt()
  positionY: number;
}
