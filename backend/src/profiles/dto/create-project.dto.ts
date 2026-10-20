import { Type } from 'class-transformer';
import { IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export class ProjectLinksDto {
  @IsOptional() @IsString() instagram?: string;
  @IsOptional() @IsString() telegram?: string;
}

export class CreateProjectDto {
  @IsString()
  @MaxLength(100, { message: 'Название проекта слишком длинное' })
  name: string;

  @IsOptional() @IsObject() @ValidateNested() @Type(() => ProjectLinksDto)
  links?: ProjectLinksDto;
}
