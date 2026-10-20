import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProfilesService } from './profiles.service';
import { RenameProfileDto } from './dto/rename-profile.dto';
import { MoveAccountDto } from './dto/move-account.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { AddProjectAccountDto } from './dto/add-project-account.dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class ProfilesController {
  constructor(private profilesService: ProfilesService) {}

  @Get('profiles')
  list() {
    return this.profilesService.list();
  }

  @Post('profiles')
  create(@Body() dto: CreateProjectDto) {
    return this.profilesService.create(dto);
  }

  @Post('profiles/:id/accounts')
  addAccount(
    @Param(
      'id',
      new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND }),
    )
    id: string,
    @Body() dto: AddProjectAccountDto,
  ) {
    return this.profilesService.addAccount(id, dto.link, dto.platform);
  }

  @Get('profiles/:id')
  get(
    @Param(
      'id',
      new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND }),
    )
    id: string,
  ) {
    return this.profilesService.get(id);
  }

  @Patch('profiles/:id')
  rename(
    @Param(
      'id',
      new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND }),
    )
    id: string,
    @Body() dto: RenameProfileDto,
  ) {
    return this.profilesService.rename(id, dto.name);
  }

  @Delete('profiles/:id')
  remove(
    @Param(
      'id',
      new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND }),
    )
    id: string,
  ) {
    return this.profilesService.remove(id);
  }

  @Patch('accounts/:id/profile')
  moveAccount(
    @Param(
      'id',
      new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND }),
    )
    id: string,
    @Body() dto: MoveAccountDto,
  ) {
    return this.profilesService.moveAccount(id, dto);
  }
}
