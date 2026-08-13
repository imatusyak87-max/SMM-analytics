import { SyncJobService } from './sync-job.service';
import { SyncTrigger, SyncStatus } from '../db/entities/sync-job.entity';
import { AccountType, AccountPlatform } from '../db/entities/account.entity';

describe('SyncJobService', () => {
  it('createManual saves a pending job and enqueues it with priority', async () => {
    const saved = { id: 'job-1', accountId: 'acc-1', trigger: SyncTrigger.MANUAL, status: SyncStatus.PENDING };
    const syncJobsRepo = { save: jest.fn().mockResolvedValue(saved), create: jest.fn((x) => x) } as any;
    const queue = { add: jest.fn() } as any;
    const service = new SyncJobService(syncJobsRepo, queue);

    const result = await service.createManual('acc-1');

    expect(syncJobsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc-1', trigger: SyncTrigger.MANUAL, status: SyncStatus.PENDING }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'sync-account',
      { syncJobId: 'job-1', accountId: 'acc-1' },
      { priority: 1 },
    );
    expect(result).toBe(saved);
  });

  it('createScheduledForAllActiveAccounts enqueues one job per active account with lower priority', async () => {
    const accounts = [
      { id: 'acc-1', isActive: true, platform: AccountPlatform.TELEGRAM, type: AccountType.OWN },
      { id: 'acc-2', isActive: true, platform: AccountPlatform.TELEGRAM, type: AccountType.OWN },
    ];
    const accountsRepo = { find: jest.fn().mockResolvedValue(accounts) } as any;
    const syncJobsRepo = {
      save: jest.fn().mockImplementation((x) => Promise.resolve({ id: `job-${x.accountId}`, ...x })),
      create: jest.fn((x) => x),
    } as any;
    const queue = { add: jest.fn() } as any;
    const service = new SyncJobService(syncJobsRepo, queue, accountsRepo);

    const result = await service.createScheduledForAllActiveAccounts();

    expect(result).toHaveLength(2);
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledWith('sync-account', expect.anything(), { priority: 10 });
  });
});
