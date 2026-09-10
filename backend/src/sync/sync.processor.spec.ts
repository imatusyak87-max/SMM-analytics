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

  function buildProcessor(overrides: Partial<{ getAccountStats: any; getPosts: any; syncJobsUpdate: any }> = {}) {
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
    const syncJobsRepo = { update: overrides.syncJobsUpdate ?? jest.fn() } as any;
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

  it('upserts posts with erViews computed against views, not reach', async () => {
    const posts = [{
      externalPostId: 'p1', type: PostType.POST, publishedAt: new Date(), permalink: null,
      thumbnailUrl: null, caption: 'hi', likes: 10, comments: 0, shares: 0, views: 200, reach: null,
    }];
    const { processor, postsRepo } = buildProcessor({ getPosts: jest.fn().mockResolvedValue(posts) });

    await processor.process({ data: { syncJobId: 'job-1', accountId: 'acc-1' } } as any);

    expect(postsRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ externalPostId: 'p1', erViews: 5 }),
      ['accountId', 'externalPostId'],
    );
  });

  it('fetches posts from a 90-day window', async () => {
    const getPosts = jest.fn().mockResolvedValue([]);
    const { processor } = buildProcessor({ getPosts });

    await processor.process({ data: { syncJobId: 'job-1', accountId: 'acc-1' } } as any);

    const since = getPosts.mock.calls[0][1] as Date;
    expect((Date.now() - since.getTime()) / 86_400_000).toBeCloseTo(90, 0);
  });

  // A job that is on its last attempt. BullMQ counts attemptsMade from 0 during the
  // first execution, so this is attempt 3 of 3.
  function finalAttempt() {
    return { data: { syncJobId: 'job-1', accountId: 'acc-1' }, attemptsMade: 2, opts: { attempts: 3 } } as any;
  }

  function retryableAttempt() {
    return { data: { syncJobId: 'job-1', accountId: 'acc-1' }, attemptsMade: 0, opts: { attempts: 3 } } as any;
  }

  it('on connector failure, marks the job failed with the error message', async () => {
    const { processor, syncJobsRepo } = buildProcessor({
      getAccountStats: jest.fn().mockRejectedValue(new Error('Forbidden: bot is not a member')),
    });

    await expect(processor.process(finalAttempt())).rejects.toThrow('Forbidden: bot is not a member');

    expect(syncJobsRepo.update).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ status: SyncStatus.FAILED, errorMessage: 'Forbidden: bot is not a member' }),
    );
  });

  it('rethrows the failure so BullMQ records the job as failed rather than successful', async () => {
    const { processor } = buildProcessor({
      getAccountStats: jest.fn().mockRejectedValue(new Error('telegram timed out')),
    });

    await expect(processor.process(finalAttempt())).rejects.toThrow('telegram timed out');
  });

  it('leaves the job running between retries, so a transient failure does not surface as final', async () => {
    const { processor, syncJobsRepo } = buildProcessor({
      getAccountStats: jest.fn().mockRejectedValue(new Error('telegram timed out')),
    });

    await expect(processor.process(retryableAttempt())).rejects.toThrow('telegram timed out');

    expect(syncJobsRepo.update).not.toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ status: SyncStatus.FAILED }),
    );
  });

  it('records the job as failed when the initial RUNNING status write is what failed', async () => {
    const syncJobsUpdate = jest
      .fn()
      .mockRejectedValueOnce(new Error('connection pool exhausted'))
      .mockResolvedValueOnce(undefined);
    const { processor, syncJobsRepo } = buildProcessor({ syncJobsUpdate });

    await expect(processor.process(finalAttempt())).rejects.toThrow('connection pool exhausted');

    expect(syncJobsRepo.update).toHaveBeenNthCalledWith(
      1,
      'job-1',
      expect.objectContaining({ status: SyncStatus.RUNNING }),
    );
    expect(syncJobsRepo.update).toHaveBeenNthCalledWith(
      2,
      'job-1',
      expect.objectContaining({ status: SyncStatus.FAILED, errorMessage: 'connection pool exhausted' }),
    );
  });

  it('rethrows the original failure, not the bookkeeping failure, when the FAILED write also fails', async () => {
    const syncJobsUpdate = jest.fn().mockRejectedValue(new Error('db is still down'));
    const { processor } = buildProcessor({ syncJobsUpdate });

    await expect(processor.process(finalAttempt())).rejects.toThrow('db is still down');
  });

  it('still writes the day\'s follower snapshot, with avgEr null, when getPosts fails', async () => {
    const { processor, snapshotsRepo } = buildProcessor({
      getPosts: jest.fn().mockRejectedValue(new Error('t.me timed out')),
    });

    await expect(processor.process(finalAttempt())).rejects.toThrow('t.me timed out');

    expect(snapshotsRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc-1', followersCount: 100, avgEr: null }),
      ['accountId', 'date'],
    );
  });

  it('still fails the job when getPosts fails, even though the snapshot was written', async () => {
    const { processor, syncJobsRepo } = buildProcessor({
      getPosts: jest.fn().mockRejectedValue(new Error('t.me timed out')),
    });

    await expect(processor.process(finalAttempt())).rejects.toThrow('t.me timed out');

    expect(syncJobsRepo.update).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ status: SyncStatus.FAILED, errorMessage: 't.me timed out' }),
    );
  });

  it('treats a job with no retry options as its own final attempt', async () => {
    const { processor, syncJobsRepo } = buildProcessor({
      getAccountStats: jest.fn().mockRejectedValue(new Error('boom')),
    });

    await expect(
      processor.process({ data: { syncJobId: 'job-1', accountId: 'acc-1' } } as any),
    ).rejects.toThrow('boom');

    expect(syncJobsRepo.update).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ status: SyncStatus.FAILED }),
    );
  });
});
