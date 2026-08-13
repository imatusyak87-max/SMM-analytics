import { IsDateString, IsOptional, IsEnum } from 'class-validator';
import { PostType } from '../../db/entities/post.entity';

export class PeriodFilterDto {
  @IsDateString() from: string;
  @IsDateString() to: string;
}

export class PostFilterDto extends PeriodFilterDto {
  @IsOptional() @IsEnum(PostType) type?: PostType;
}
