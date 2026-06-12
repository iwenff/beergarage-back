import { IsArray, IsInt, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ChairStatusDto {
  @IsInt()
  id: number;

  @IsIn(['blocked', 'free'])
  status: 'blocked' | 'free';

  @IsOptional()
  @IsString()
  blockColor?: string;
}

export class UpdateChairsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChairStatusDto)
  chairs: ChairStatusDto[];
}
