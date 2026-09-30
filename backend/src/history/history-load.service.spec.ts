import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { HistoryLoadService } from './history-load.service';
import { HistoryLoadPhase, HistoryLoadStatus } from '../db/entities/history-load.entity';
import { AccountPlatform } from '../db/entities/account.entity';

function setup({ existing = null as any, account = { id: 'acc-1', platform: AccountPlatform.TELEGRAM } as any, canLoad = true } = {}) {
  const loadsRepo = {
    findOneBy: jest.fn().mockResolvedValue(existing),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: 'load-1', ...x })),
  };
  const accountsRepo = { findOneBy: jest.fn().mockResolvedValue(account) };
  const registry = { get: jest.fn().mockReturnValue(canLoad ? { loadHistoryPage: jest.fn() } : {}) };
  const queue = { add: jest.fn(), getJobs: jest.fn().mockResolvedValue([]) };
  const service = new HistoryLoadService(loadsRepo as any, accountsRepo as any, registry as any, queue as any);
  return { service, loadsRepo, queue };
}

describe('HistoryLoadService.start', () => {
  it('creates a fresh load and queues its first slice', async () => {
    const { service, loadsRepo, queue } = setup();

    const view = await service.start('acc-1');

    expect(loadsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'acc-1', status: HistoryLoadStatus.QUEUED, phase: HistoryLoadPhase.POSTS, cursor: null, postsLoaded: 0 }));
    expect(queue.add).toHaveBeenCalledWith('history-slice', { accountId: 'acc-1' }, expect.objectContaining({ delay: 0 }));
    expect(view.status).toBe(HistoryLoadStatus.QUEUED);
    expect(view).not.toHaveProperty('cursor');
  });

  it('restarts a finished load from the newest post', async () => {
    const existing = { id: 'load-1', accountId: 'acc-1', status: HistoryLoadStatus.DONE, phase: HistoryLoadPhase.INSIGHTS, cursor: 'x', postsLoaded: 900, insightsDone: 50, insightsTotal: 50 };
    const { service, loadsRepo } = setup({ existing });

    await service.start('acc-1');

    expect(loadsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'load-1', status: HistoryLoadStatus.QUEUED, phase: HistoryLoadPhase.POSTS, cursor: null, postsLoaded: 0, insightsDone: 0, insightsTotal: 0 }));
  });

  it('continues a failed load from where it stopped', async () => {
    const existing = { id: 'load-1', accountId: 'acc-1', status: HistoryLoadStatus.FAILED, phase: HistoryLoadPhase.POSTS, cursor: 'p:500', postsLoaded: 300, errorMessage: 'x' };
    const { service, loadsRepo } = setup({ existing });

    await service.start('acc-1');

    expect(loadsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: HistoryLoadStatus.QUEUED, cursor: 'p:500', postsLoaded: 300, errorMessage: null }));
  });

  it.each([HistoryLoadStatus.QUEUED, HistoryLoadStatus.RUNNING, HistoryLoadStatus.PAUSED])('does not start a second load while one is %s', async (status) => {
    const { service, loadsRepo, queue } = setup({ existing: { id: 'load-1', accountId: 'acc-1', status } });

    const view = await service.start('acc-1');

    expect(view.status).toBe(status);
    expect(loadsRepo.save).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('refuses an unknown account', async () => {
    const { service } = setup({ account: null });
    await expect(service.start('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a platform without history support', async () => {
    const { service } = setup({ canLoad: false });
    await expect(service.start('acc-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('HistoryLoadService.resumeStranded', () => {
  it('re-queues an unfinished load that has no job in the queue, honouring a pause', async () => {
    const pausedUntil = new Date(Date.now() + 60_000);
    const { service, loadsRepo, queue } = setup();
    loadsRepo.find.mockResolvedValue([
      { accountId: 'acc-1', status: HistoryLoadStatus.RUNNING },
      { accountId: 'acc-2', status: HistoryLoadStatus.PAUSED, pausedUntil },
      { accountId: 'acc-3', status: HistoryLoadStatus.QUEUED },
    ]);
    queue.getJobs.mockResolvedValue([{ data: { accountId: 'acc-3' } }]);

    await service.resumeStranded();

    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledWith('history-slice', { accountId: 'acc-1' }, expect.objectContaining({ delay: 0 }));
    const acc2 = queue.add.mock.calls.find(([, data]: [string, { accountId: string }]) => data.accountId === 'acc-2');
    expect(acc2[2].delay).toBeGreaterThan(50_000);
  });

  it('does not throw when the queue is unreachable', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const { service, loadsRepo, queue } = setup();
      loadsRepo.find.mockResolvedValue([{ accountId: 'acc-1', status: HistoryLoadStatus.RUNNING }]);
      queue.getJobs.mockRejectedValue(new Error('Redis down'));

      await expect(service.resumeStranded()).resolves.toBeUndefined();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
