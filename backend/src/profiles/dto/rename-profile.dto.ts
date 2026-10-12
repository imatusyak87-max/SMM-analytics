import { IsString, MaxLength } from 'class-validator';

export class RenameProfileDto {
  @IsString() @MaxLength(100) name: string;
}
