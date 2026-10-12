import { IsString, MaxLength } from 'class-validator';

export class RenameProfileDto {
  @IsString()
  @MaxLength(100, { message: 'Название профиля слишком длинное' })
  name: string;
}
