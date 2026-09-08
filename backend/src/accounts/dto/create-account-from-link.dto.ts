import { IsString } from 'class-validator';

export class CreateAccountFromLinkDto {
  @IsString() link: string;
}
