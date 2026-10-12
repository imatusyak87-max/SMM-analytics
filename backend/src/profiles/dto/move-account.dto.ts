import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

/** Exactly one of the two; the service enforces that. */
export class MoveAccountDto {
  @IsOptional() @IsUUID() profileId?: string;
  @IsOptional() @IsBoolean() newProfile?: boolean;
}
