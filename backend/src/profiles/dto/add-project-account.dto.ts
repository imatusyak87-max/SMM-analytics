import { IsIn, IsOptional, IsString } from 'class-validator';
import { AccountPlatform } from '../../db/entities/account.entity';

export class AddProjectAccountDto {
  @IsString() link: string;
  /** The network the tile it was added from is for; a link to another network is refused. */
  @IsOptional() @IsIn([AccountPlatform.INSTAGRAM, AccountPlatform.TELEGRAM]) platform?: AccountPlatform;
}
