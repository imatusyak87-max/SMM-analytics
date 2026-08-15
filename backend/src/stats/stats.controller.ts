import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StatsService } from './stats.service';
import { PostType } from '../db/entities/post.entity';

@UseGuards(JwtAuthGuard)
@Controller()
export class StatsController {
  constructor(private statsService: StatsService) {}

  @Get('stats/overview')
  overview() {
    return this.statsService.getOverview();
  }

  @Get('accounts/:id/detail')
  detail(@Param('id') id: string, @Query('from') from: string, @Query('to') to: string) {
    return this.statsService.getAccountDetail(id, { from, to });
  }

  @Get('accounts/:id/top-posts')
  topPosts(
    @Param('id') id: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('type') type?: PostType,
    @Query('limit') limit = '10',
  ) {
    return this.statsService.getTopPosts(id, { from, to, type }, Number(limit));
  }

  @Get('stats/compare')
  compare(@Query('accountIds') accountIds: string, @Query('from') from: string, @Query('to') to: string) {
    return this.statsService.compare(accountIds.split(','), { from, to });
  }
}
