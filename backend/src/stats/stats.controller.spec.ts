import { StatsController } from './stats.controller';

describe('StatsController', () => {
  function buildController(overrides: Partial<Record<string, jest.Mock>> = {}) {
    const statsService = {
      getOverview: overrides.getOverview ?? jest.fn().mockResolvedValue([]),
      getAccountDetail: overrides.getAccountDetail ?? jest.fn().mockResolvedValue({}),
      getPostsPage: overrides.getPostsPage ?? jest.fn().mockResolvedValue({ total: 0, items: [] }),
      compare: overrides.compare ?? jest.fn().mockResolvedValue([]),
    } as any;
    return new StatsController(statsService);
  }

  it('overview calls StatsService.getOverview', async () => {
    const controller = buildController();
    await controller.overview();
    expect(controller['statsService'].getOverview).toHaveBeenCalled();
  });

  it('detail passes accountId and period through', async () => {
    const controller = buildController();
    await controller.detail('acc-1', { from: '2026-08-01', to: '2026-08-13' });
    expect(controller['statsService'].getAccountDetail).toHaveBeenCalledWith('acc-1', { from: '2026-08-01', to: '2026-08-13' });
  });

  it('compare splits the comma-separated accountIds query param', async () => {
    const controller = buildController();
    await controller.compare({ accountIds: 'acc-1,acc-2', from: '2026-08-01', to: '2026-08-13' });
    expect(controller['statsService'].compare).toHaveBeenCalledWith(['acc-1', 'acc-2'], { from: '2026-08-01', to: '2026-08-13' });
  });

  it('posts fills in the defaults for sort, page and size', async () => {
    const controller = buildController();
    await controller.posts('acc-1', { from: '2026-08-01', to: '2026-08-13' });
    expect(controller['statsService'].getPostsPage).toHaveBeenCalledWith('acc-1', {
      from: '2026-08-01',
      to: '2026-08-13',
      type: undefined,
      sort: 'views',
      page: 1,
      size: 10,
    });
  });
});
