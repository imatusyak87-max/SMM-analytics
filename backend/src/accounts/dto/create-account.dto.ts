import { IsEnum, IsString, IsOptional } from 'class-validator';
import { AccountPlatform, AccountType } from '../../db/entities/account.entity';

export class CreateAccountDto {
  @IsEnum(AccountPlatform) platform: AccountPlatform;
  @IsString() externalId: string;
  @IsString() name: string;
  @IsOptional() @IsString() avatarUrl?: string;
  @IsEnum(AccountType) type: AccountType;
}
