import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProfilesService } from './profiles.service';
import { RenameProfileDto } from './dto/rename-profile.dto';
import { MoveAccountDto } from './dto/move-account.dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class ProfilesController {
  constructor(private profilesService: ProfilesService) {}

  @Get('profiles')
  list() {
    return this.profilesService.list();
  }

  @Get('profiles/:id')
  get(@Param('id') id: string) {
    return this.profilesService.get(id);
  }

  @Patch('profiles/:id')
  rename(@Param('id') id: string, @Body() dto: RenameProfileDto) {
    return this.profilesService.rename(id, dto.name);
  }

  @Patch('accounts/:id/profile')
  moveAccount(@Param('id') id: string, @Body() dto: MoveAccountDto) {
    return this.profilesService.moveAccount(id, dto);
  }
}
