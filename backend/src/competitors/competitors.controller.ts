import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompetitorRunService } from './competitor-run.service';
import { CompetitorsService } from './competitors.service';

@UseGuards(JwtAuthGuard)
@Controller('accounts/:accountId/competitors')
export class CompetitorsController {
  constructor(
    private competitors: CompetitorsService,
    private runs: CompetitorRunService,
  ) {}

  @Get()
  get(@Param('accountId') accountId: string) {
    return this.competitors.getFor(accountId);
  }

  @Post('refresh')
  refresh(@Param('accountId') accountId: string) {
    return this.runs.createManual(accountId);
  }
}
