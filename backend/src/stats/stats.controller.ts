import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StatsService } from './stats.service';
import { CompareFilterDto, PeriodFilterDto, PostsPageFilterDto } from './dto/post-filter.dto';

const DEFAULT_PAGE_SIZE = 10;

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

  @Get('accounts/:id/posts')
  posts(@Param('id') id: string, @Query() filter: PostsPageFilterDto) {
    return this.statsService.getPostsPage(id, {
      from: filter.from,
      to: filter.to,
      type: filter.type,
      sort: filter.sort ?? 'views',
      page: filter.page ?? 1,
      size: filter.size ?? DEFAULT_PAGE_SIZE,
    });
  }

  @Get('stats/compare')
  compare(@Query() filter: CompareFilterDto) {
    return this.statsService.compare(filter.accountIds.split(','), {
      from: filter.from,
      to: filter.to,
    });
  }
}
