import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { HistoryLoadService } from './history-load.service';

@UseGuards(JwtAuthGuard)
@Controller('accounts/:accountId/history-load')
export class HistoryController {
  constructor(private loads: HistoryLoadService) {}

  @Post()
  start(@Param('accountId') accountId: string) {
    return this.loads.start(accountId);
  }

  @Get()
  get(@Param('accountId') accountId: string) {
    return this.loads.get(accountId);
  }
}
