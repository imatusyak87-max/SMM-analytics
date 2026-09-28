import { HistoryRunner, POSTS_UNITS_PER_SLICE, INSIGHTS_PER_SLICE } from './history-runner';
import { HistoryLoadPhase, HistoryLoadStatus, HistoryPauseReason } from '../db/entities/history-load.entity';
import { AccountPlatform } from '../db/entities/account.entity';
import { HistoryPauseError } from '../connectors/history-pause.error';
import { Logger } from '@nestjs/common';

const DAY = 86_400_000;

function makeLoad(overrides = {}) {
  return {
    id: 'load-1',
    accountId: 'acc-1',
    status: HistoryLoadStatus.QUEUED,
    phase: HistoryLoadPhase.POSTS,
    cursor: null,
    postsLoaded: 0,
    oldestPostAt: null,
    insightsDone: 0,
    insightsTotal: 0,
    pausedUntil: null,
    pauseReason: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  } as any;
}

const connectorPost = (id: string, daysAgo: number) => ({
  externalPostId: id,
  type: 'image',
  publishedAt: new Date(Date.now() - daysAgo * DAY),
  permalink: null,
  thumbnailUrl: null,
  caption: null,
  likes: 1,
  comments: 0,
  shares: 0,
  views: null,
  reach: null,
});

function setup({ load = makeLoad(), platform = AccountPlatform.TELEGRAM, connector = {} as any, followers = 500 } = {}) {
  const loadsRepo = { findOneBy: jest.fn().mockResolvedValue(load), update: jest.fn() };
  const accountsRepo = { findOneBy: jest.fn().mockResolvedValue({ id: 'acc-1', platform }) };
  const snapshotsRepo = { findOne: jest.fn().mockResolvedValue(followers === null ? null : { followersCount: followers }) };
  const registry = { get: jest.fn().mockReturnValue(connector) };
  const store = {
    write: jest.fn(),
    countInsightTargets: jest.fn().mockResolvedValue(0),
    nextInsightTargets: jest.fn().mockResolvedValue([]),
    saveInsights: jest.fn(),
  };
  const runner = new HistoryRunner(loadsRepo as any, accountsRepo as any, snapshotsRepo as any, registry as any, store as any, {
    unitDelayMs: 0,
    insightDelayMs: 0,
  });
  return { runner, load, loadsRepo, accountsRepo, snapshotsRepo, store, connector };
}

/** The fields of the last progress write. */
const lastWrite = (loadsRepo: any) => loadsRepo.update.mock.calls.at(-1)[1];

describe('HistoryRunner.runSlice — posts phase', () => {
  it('reads pages from the saved cursor, saves posts and progress, and asks for another slice', async () => {
    const connector = {
      loadHistoryPage: jest.fn().mockResolvedValue({ posts: [connectorPost('9', 400), connectorPost('8', 410)], nextCursor: 'p:8' }),
    };
    const { runner, loadsRepo, store } = setup({ load: makeLoad({ cursor: 'p:10', postsLoaded: 5 }), connector });

    const next = await runner.runSlice('acc-1');

    expect(connector.loadHistoryPage).toHaveBeenNthCalledWith(1, { id: 'acc-1', platform: AccountPlatform.TELEGRAM }, 'p:10');
    expect(connector.loadHistoryPage).toHaveBeenCalledTimes(POSTS_UNITS_PER_SLICE);
    expect(store.write).toHaveBeenCalledWith('acc-1', expect.any(Array), 500, false);
    expect(lastWrite(loadsRepo)).toMatchObject({ status: HistoryLoadStatus.RUNNING, cursor: 'p:8', postsLoaded: 5 + 2 * POSTS_UNITS_PER_SLICE });
    expect(next).toBe(0);
  });

  it('records the oldest post reached', async () => {
    const connector = { loadHistoryPage: jest.fn().mockResolvedValue({ posts: [connectorPost('1', 900), connectorPost('2', 800)], nextCursor: null }) };
    const { runner, loadsRepo } = setup({ connector });

    await runner.runSlice('acc-1');

    expect(lastWrite(loadsRepo).oldestPostAt.getTime()).toBeLessThan(Date.now() - 899 * DAY);
  });

  it('finishes a Telegram load when history is exhausted', async () => {
    const connector = { loadHistoryPage: jest.fn().mockResolvedValue({ posts: [connectorPost('1', 900)], nextCursor: null }) };
    const { runner, loadsRepo } = setup({ connector });

    const next = await runner.runSlice('acc-1');

    expect(connector.loadHistoryPage).toHaveBeenCalledTimes(1);
    expect(lastWrite(loadsRepo)).toMatchObject({ status: HistoryLoadStatus.DONE, cursor: null });
    expect(lastWrite(loadsRepo).finishedAt).toBeInstanceOf(Date);
    expect(next).toBeNull();
  });

  it('moves an Instagram load on to the insights phase, preserving insight columns meanwhile', async () => {
    const connector = {
      loadHistoryPage: jest.fn().mockResolvedValue({ posts: [connectorPost('m1', 400)], nextCursor: null }),
      loadPostInsights: jest.fn(),
    };
    const { runner, loadsRepo, store } = setup({ platform: AccountPlatform.INSTAGRAM, connector });
    store.countInsightTargets.mockResolvedValue(37);

    const next = await runner.runSlice('acc-1');

    expect(store.write).toHaveBeenCalledWith('acc-1', expect.any(Array), 500, true);
    expect(lastWrite(loadsRepo)).toMatchObject({ phase: HistoryLoadPhase.INSIGHTS, cursor: null, insightsDone: 0, insightsTotal: 37, status: HistoryLoadStatus.RUNNING });
    expect(next).toBe(0);
  });

  it('falls back to live follower stats when the account has no snapshot yet', async () => {
    const connector = {
      getAccountStats: jest.fn().mockResolvedValue({ followersCount: 77 }),
      loadHistoryPage: jest.fn().mockResolvedValue({ posts: [], nextCursor: null }),
    };
    const { runner, store } = setup({ connector, followers: null as any });
    connector.loadHistoryPage.mockResolvedValue({ posts: [connectorPost('1', 400)], nextCursor: null });

    await runner.runSlice('acc-1');

    expect(store.write).toHaveBeenCalledWith('acc-1', expect.any(Array), 77, false);
  });
});

describe('HistoryRunner.runSlice — insights phase', () => {
  const storedPost = (id: string) => ({ id: `row-${id}`, externalPostId: id, publishedAt: new Date('2024-01-01T00:00:00Z'), likes: 1, comments: 0, shares: 0, reach: null });

  it('fills insights one post at a time and advances the cursor', async () => {
    const connector = { loadHistoryPage: jest.fn(), loadPostInsights: jest.fn().mockResolvedValue({ reach: 10, shares: 1 }) };
    const load = makeLoad({ phase: HistoryLoadPhase.INSIGHTS, insightsTotal: 100, insightsDone: 3, cursor: 'c0' });
    const { runner, loadsRepo, store } = setup({ load, platform: AccountPlatform.INSTAGRAM, connector });
    store.nextInsightTargets.mockResolvedValue(Array.from({ length: INSIGHTS_PER_SLICE }, (_, i) => storedPost(`p${i}`)));

    const next = await runner.runSlice('acc-1');

    expect(store.nextInsightTargets).toHaveBeenCalledWith('acc-1', expect.any(Date), 'c0', INSIGHTS_PER_SLICE);
    expect(connector.loadPostInsights).toHaveBeenCalledTimes(INSIGHTS_PER_SLICE);
    expect(store.saveInsights).toHaveBeenCalledWith(expect.objectContaining({ externalPostId: 'p0' }), { reach: 10, shares: 1 }, 500);
    expect(lastWrite(loadsRepo)).toMatchObject({ insightsDone: 3 + INSIGHTS_PER_SLICE, cursor: `2024-01-01T00:00:00.000Z|p${INSIGHTS_PER_SLICE - 1}` });
    expect(next).toBe(0);
  });

  it('finishes when fewer targets than a full slice remain', async () => {
    const connector = { loadHistoryPage: jest.fn(), loadPostInsights: jest.fn().mockResolvedValue({ reach: 10, shares: 1 }) };
    const load = makeLoad({ phase: HistoryLoadPhase.INSIGHTS, insightsTotal: 2 });
    const { runner, loadsRepo, store } = setup({ load, platform: AccountPlatform.INSTAGRAM, connector });
    store.nextInsightTargets.mockResolvedValue([storedPost('a'), storedPost('b')]);

    const next = await runner.runSlice('acc-1');

    expect(lastWrite(loadsRepo)).toMatchObject({ status: HistoryLoadStatus.DONE, insightsDone: 2 });
    expect(next).toBeNull();
  });
});

describe('HistoryRunner.runSlice — pauses and failures', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('pauses on a HistoryPauseError and asks for the next slice after the pause', async () => {
    const connector = {
      loadHistoryPage: jest.fn().mockRejectedValue(new HistoryPauseError(HistoryPauseReason.TELEGRAM_RATE_LIMIT, 300_000, 'Telegram ограничил запросы, продолжим через 5 минут')),
    };
    const { runner, loadsRepo } = setup({ load: makeLoad({ cursor: 'p:50' }), connector });

    const next = await runner.runSlice('acc-1');

    expect(next).toBe(300_000);
    expect(lastWrite(loadsRepo)).toMatchObject({ status: HistoryLoadStatus.PAUSED, pauseReason: HistoryPauseReason.TELEGRAM_RATE_LIMIT, cursor: 'p:50' });
    expect(lastWrite(loadsRepo).pausedUntil.getTime()).toBeGreaterThan(Date.now() + 299_000);
  });

  it('fails with the error message, keeping the cursor, on anything else', async () => {
    const connector = { loadHistoryPage: jest.fn().mockRejectedValue(new Error('Instagram отклонил доступ, нужно переподключить аккаунт')) };
    const { runner, loadsRepo } = setup({ load: makeLoad({ cursor: 'CUR' }), connector });

    const next = await runner.runSlice('acc-1');

    expect(next).toBeNull();
    expect(lastWrite(loadsRepo)).toMatchObject({ status: HistoryLoadStatus.FAILED, cursor: 'CUR', errorMessage: 'Instagram отклонил доступ, нужно переподключить аккаунт' });
  });

  it('falls back to a Russian message when the error is not user-facing', async () => {
    const connector = { loadHistoryPage: jest.fn().mockRejectedValue(new Error('duplicate key value violates unique constraint')) };
    const { runner, loadsRepo } = setup({ load: makeLoad({ cursor: 'CUR' }), connector });

    const next = await runner.runSlice('acc-1');

    expect(next).toBeNull();
    expect(lastWrite(loadsRepo)).toMatchObject({ status: HistoryLoadStatus.FAILED, errorMessage: 'непредвиденная ошибка' });
  });

  it('keeps progress already saved before a later page pauses', async () => {
    const connector = {
      loadHistoryPage: jest
        .fn()
        .mockResolvedValueOnce({ posts: [connectorPost('9', 400)], nextCursor: 'p:9' })
        .mockRejectedValueOnce(new HistoryPauseError(HistoryPauseReason.NETWORK, 300_000, 'Проблема с сетью, продолжим через 5 минут')),
    };
    const { runner, loadsRepo } = setup({ connector });

    await runner.runSlice('acc-1');

    expect(lastWrite(loadsRepo)).toMatchObject({ status: HistoryLoadStatus.PAUSED, cursor: 'p:9', postsLoaded: 1 });
  });

  it('does nothing when the load was finished, failed or deleted meanwhile', async () => {
    for (const load of [makeLoad({ status: HistoryLoadStatus.DONE }), makeLoad({ status: HistoryLoadStatus.FAILED }), null]) {
      const connector = { loadHistoryPage: jest.fn() };
      const { runner, loadsRepo } = setup({ load, connector });
      expect(await runner.runSlice('acc-1')).toBeNull();
      expect(connector.loadHistoryPage).not.toHaveBeenCalled();
      expect(loadsRepo.update).not.toHaveBeenCalled();
    }
  });

  it('does nothing when the account was deleted meanwhile', async () => {
    const connector = { loadHistoryPage: jest.fn() };
    const { runner, accountsRepo, loadsRepo } = setup({ connector });
    accountsRepo.findOneBy.mockResolvedValue(null);

    expect(await runner.runSlice('acc-1')).toBeNull();
    expect(loadsRepo.update).not.toHaveBeenCalled();
  });

  it('writes progress with update(), never save(), so a deleted row is not recreated', async () => {
    const connector = { loadHistoryPage: jest.fn().mockResolvedValue({ posts: [], nextCursor: null }) };
    const { runner, loadsRepo } = setup({ connector });

    await runner.runSlice('acc-1');

    expect(loadsRepo.update.mock.calls.every(([criteria]: [unknown]) => JSON.stringify(criteria) === JSON.stringify({ id: 'load-1' }))).toBe(true);
    expect(lastWrite(loadsRepo)).not.toHaveProperty('id');
    expect(lastWrite(loadsRepo)).not.toHaveProperty('accountId');
  });
});
