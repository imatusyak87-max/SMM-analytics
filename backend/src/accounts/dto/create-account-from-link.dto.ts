import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateAccountFromLinkDto {
  @IsString() link: string;
  /** Profile to add the account to; a new one is created when absent. */
  @IsOptional() @IsUUID() profileId?: string;
}
