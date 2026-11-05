import { IsUUID } from 'class-validator';

export class MoveAccountDto {
  @IsUUID() profileId: string;
}
