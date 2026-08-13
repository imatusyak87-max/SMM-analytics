import { SyncProcessor } from './sync.processor';
import { SyncStatus } from '../db/entities/sync-job.entity';
import { AccountPlatform, AccountType } from '../db/entities/account.entity';
import { PostType } from '../db/entities/post.entity';

describe('SyncProcessor', () => {
  const account = {
    id: 'acc-1',
    platform: AccountPlatform.TELEGRAM,
    externalId: '@chan',
    name: 'Chan',
    type: AccountType.OWN,
    isActive: true,
  };

  function buildProcessor(overrides: Partial<{ getAccountStats: any; getPosts: any }> = {}) {
    const connector = {
      platform: AccountPlatform.TELEGRAM,
      getAccountInfo: jest.fn(),
      getAccountStats: overrides.getAccountStats ?? jest.fn().mockResolvedValue({ followersCount: 100, followingCount: null, postsCount: 3 }),
      getPosts: overrides.getPosts ?? jest.fn().mockResolvedValue([]),
    };
    const registry = { get: jest.fn().mockReturnValue(connector) } as any;
    const accountsRepo = { findOneBy: jest.fn().mockResolvedValue(account) } as any;
    const snapshotsRepo = { upsert: jest.fn() } as any;
    const postsRepo = { upsert: jest.fn() } as any;
    const syncJobsRepo = { update: jest.fn() } as any;
    const processor = new SyncProcessor(registry, accountsRepo, snapshotsRepo, postsRepo, syncJobsRepo);
    return { processor, syncJobsRepo, snapshotsRepo, postsRepo };
  }

  it('on success, writes a snapshot and marks the job success', async () => {
    const { processor, syncJobsRepo, snapshotsRepo } = buildProcessor();

    await processor.process({ data: { syncJobId: 'job-1', accountId: 'acc-1' } } as any);

    expect(snapshotsRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc-1', followersCount: 100 }),
      ['accountId', 'date'],
    );
    expect(syncJobsRepo.update).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: SyncStatus.SUCCESS }));
  });

  it('upserts posts returned by the connector with computed ER', async () => {
    const posts = [{
      externalPostId: 'p1', type: PostType.POST, publishedAt: new Date(), permalink: null,
      thumbnailUrl: null, caption: 'hi', likes: 10, comments: 5, shares: 0, views: null, reach: null,
    }];
    const { processor, postsRepo } = buildProcessor({ getPosts: jest.fn().mockResolvedValue(posts) });

    await processor.process({ data: { syncJobId: 'job-1', accountId: 'acc-1' } } as any);

    expect(postsRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ externalPostId: 'p1', er: 15 }),
      ['accountId', 'externalPostId'],
    );
  });

  it('on connector failure, marks the job failed with the error message', async () => {
    const { processor, syncJobsRepo } = buildProcessor({
      getAccountStats: jest.fn().mockRejectedValue(new Error('Forbidden: bot is not a member')),
    });

    await processor.process({ data: { syncJobId: 'job-1', accountId: 'acc-1' } } as any);

    expect(syncJobsRepo.update).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ status: SyncStatus.FAILED, errorMessage: 'Forbidden: bot is not a member' }),
    );
  });
});
