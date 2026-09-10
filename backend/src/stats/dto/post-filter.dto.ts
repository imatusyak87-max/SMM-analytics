import { IsDateString, IsIn, IsOptional, IsEnum, IsInt, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PostType } from '../../db/entities/post.entity';

export const POST_SORTS = ['views', 'reactions', 'er', 'date'] as const;
export type PostSortKey = (typeof POST_SORTS)[number];

export const PAGE_SIZES = [10, 25, 50, 100] as const;

export class PeriodFilterDto {
  @IsDateString() from: string;
  @IsDateString() to: string;
}

export class PostFilterDto extends PeriodFilterDto {
  @IsOptional() @IsEnum(PostType) type?: PostType;
}

export class PostsPageFilterDto extends PostFilterDto {
  @IsOptional() @IsIn([...POST_SORTS]) sort?: PostSortKey;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsIn([...PAGE_SIZES]) size?: number;
}

export class CompareFilterDto extends PeriodFilterDto {
  @IsString() accountIds: string;
}
