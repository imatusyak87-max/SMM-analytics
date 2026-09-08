import { SyncScheduler } from './sync.scheduler';

describe('SyncScheduler', () => {
  it('triggerDailySync delegates to SyncJobService', async () => {
    const syncJobService = { createScheduledForAllActiveAccounts: jest.fn().mockResolvedValue([]) } as any;
    const scheduler = new SyncScheduler(syncJobService);

    await scheduler.triggerDailySync();

    expect(syncJobService.createScheduledForAllActiveAccounts).toHaveBeenCalled();
  });
});
