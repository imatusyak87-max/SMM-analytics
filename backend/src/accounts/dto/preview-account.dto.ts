import { IsIn, IsOptional, IsString } from 'class-validator';
import { AccountPlatform } from '../../db/entities/account.entity';

export class PreviewAccountDto {
  @IsString() link: string;
  /** The network of the field the link was typed into; a link to another network is refused. */
  @IsOptional() @IsIn([AccountPlatform.INSTAGRAM, AccountPlatform.TELEGRAM]) platform?: AccountPlatform;
}
