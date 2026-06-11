import { IsArray, IsInt, IsIn, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ChairStatusDto {
  @IsInt()
  id: number;

  @IsIn(['reserved', 'free'])
  status: 'reserved' | 'free';
}

export class UpdateChairsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChairStatusDto)
  chairs: ChairStatusDto[];
}
