import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StatsService } from './stats.service';
import { CompareFilterDto, PeriodFilterDto, TopPostsFilterDto } from './dto/post-filter.dto';

const DEFAULT_TOP_POSTS_LIMIT = 10;

@UseGuards(JwtAuthGuard)
@Controller()
export class StatsController {
  constructor(private statsService: StatsService) {}

  @Get('stats/overview')
  overview() {
    return this.statsService.getOverview();
  }

  @Get('accounts/:id/detail')
  detail(@Param('id') id: string, @Query() filter: PeriodFilterDto) {
    return this.statsService.getAccountDetail(id, { from: filter.from, to: filter.to });
  }

  @Get('accounts/:id/top-posts')
  topPosts(@Param('id') id: string, @Query() filter: TopPostsFilterDto) {
    return this.statsService.getTopPosts(
      id,
      { from: filter.from, to: filter.to, type: filter.type },
      filter.limit ?? DEFAULT_TOP_POSTS_LIMIT,
    );
  }

  @Get('stats/compare')
  compare(@Query() filter: CompareFilterDto) {
    return this.statsService.compare(filter.accountIds.split(','), {
      from: filter.from,
      to: filter.to,
    });
  }
}
