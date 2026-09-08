import { IsDateString, IsOptional, IsEnum, IsInt, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PostType } from '../../db/entities/post.entity';

export class PeriodFilterDto {
  @IsDateString() from: string;
  @IsDateString() to: string;
}

export class PostFilterDto extends PeriodFilterDto {
  @IsOptional() @IsEnum(PostType) type?: PostType;
}

export class TopPostsFilterDto extends PostFilterDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class CompareFilterDto extends PeriodFilterDto {
  @IsString() accountIds: string;
}
