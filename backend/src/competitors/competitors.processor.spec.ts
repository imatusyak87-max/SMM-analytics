import { CompetitorsProcessor } from './competitors.processor';
import { CompetitorRunStatus } from '../db/entities/competitor-run.entity';
import { CompetitorSuggestion } from '../db/entities/competitor-suggestion.entity';
import { scoreCandidate } from './score';

const profile = {
  handle: 'mychannel',
  title: 'Мой канал',
  followersCount: 5000,
  description: null,
  captions: [],
};

function makeProcessor(overrides: any = {}) {
  const accountsRepo = { findOneBy: jest.fn().mockResolvedValue({ id: 'acc-1', externalId: 'mychannel' }) };
  const runsRepo = { update: jest.fn() };
  const em = overrides.em ?? { delete: jest.fn(), save: jest.fn(), create: jest.fn((_entity, x) => x) };
  const suggestionsRepo = {
    delete: jest.fn(),
    save: jest.fn(),
    create: jest.fn((x) => x),
    manager: { transaction: jest.fn(async (cb: any) => cb(em)) },
  };
  const profiles = { build: jest.fn().mockResolvedValue(profile) };
  const finder = overrides.finder ?? {
    suggest: jest.fn().mockResolvedValue({
      niche: 'SMM',
      candidates: [
        { handle: 'rival', reason: 'Та же тема', fit: 9 },
        { handle: 'ghost', reason: 'Не существует', fit: 8 },
      ],
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      inputTokens: 1200,
      outputTokens: 300,
      costUsd: 0,
    }),
  };
  const verifier = overrides.verifier ?? {
    verify: jest.fn().mockResolvedValue([
      { handle: 'rival', name: 'Конкурент', followersCount: 4800, reason: 'Та же тема', fit: 9 },
    ]),
  };
  const processor = new CompetitorsProcessor(
    accountsRepo as any,
    runsRepo as any,
    suggestionsRepo as any,
    profiles as any,
    finder as any,
    verifier as any,
  );
  return { processor, runsRepo, suggestionsRepo, em, finder, verifier };
}

const job = (attemptsMade = 1) =>
  ({ data: { runId: 'run-1', accountId: 'acc-1' }, opts: { attempts: 2 }, attemptsMade }) as any;

describe('CompetitorsProcessor', () => {
  it('stores verified suggestions, the niche and the usage of a successful run, atomically', async () => {
    const { processor, runsRepo, suggestionsRepo, em } = makeProcessor();

    await processor.process(job());

    // Delete + save must go through the same transactional entity manager, never
    // through the repo's own non-transactional methods, so they commit or roll
    // back together.
    expect(em.delete).toHaveBeenCalledWith(CompetitorSuggestion, { accountId: 'acc-1' });
    expect(em.save).toHaveBeenCalledWith([
      expect.objectContaining({ externalId: 'rival', name: 'Конкурент', followersCount: 4800, rank: 1, fit: 9 }),
    ]);
    expect(suggestionsRepo.delete).not.toHaveBeenCalled();
    expect(suggestionsRepo.save).not.toHaveBeenCalled();

    expect(runsRepo.update).toHaveBeenLastCalledWith(
      'run-1',
      expect.objectContaining({
        status: CompetitorRunStatus.SUCCESS,
        niche: 'SMM',
        candidatesProposed: 2,
        candidatesVerified: 1,
        inputTokens: 1200,
        outputTokens: 300,
      }),
    );
  });

  it('keeps the previous suggestions when a run fails', async () => {
    const { processor, suggestionsRepo, em } = makeProcessor({
      finder: { suggest: jest.fn().mockRejectedValue(new Error('Превышен лимит запросов, попробуйте позже')) },
    });

    await expect(processor.process(job())).rejects.toThrow('Превышен лимит запросов');

    expect(suggestionsRepo.manager.transaction).not.toHaveBeenCalled();
    expect(em.delete).not.toHaveBeenCalled();
    expect(suggestionsRepo.delete).not.toHaveBeenCalled();
  });

  it('records FAILED only on the final attempt', async () => {
    const { processor, runsRepo } = makeProcessor({
      finder: { suggest: jest.fn().mockRejectedValue(new Error('Gemini не ответил')) },
    });

    await expect(processor.process(job(0))).rejects.toThrow();

    expect(runsRepo.update).not.toHaveBeenCalledWith('run-1', expect.objectContaining({ status: CompetitorRunStatus.FAILED }));
  });

  it('marks a run successful with no suggestions when nothing verifies', async () => {
    const { processor, runsRepo, suggestionsRepo, em } = makeProcessor({
      verifier: { verify: jest.fn().mockResolvedValue([]) },
    });

    await processor.process(job());

    expect(em.save).not.toHaveBeenCalled();
    expect(suggestionsRepo.save).not.toHaveBeenCalled();
    expect(runsRepo.update).toHaveBeenLastCalledWith(
      'run-1',
      expect.objectContaining({ status: CompetitorRunStatus.SUCCESS, candidatesVerified: 0 }),
    );
  });

  it('ranks by score descending and keeps only the best 10 of 12 verified candidates', async () => {
    const ownFollowers = profile.followersCount;
    const raw = [
      { handle: 'a', name: 'A', followersCount: 4800, reason: 'r', fit: 9 },
      { handle: 'b', name: 'B', followersCount: 100, reason: 'r', fit: 9 },
      { handle: 'c', name: 'C', followersCount: 5200, reason: 'r', fit: 10 },
      { handle: 'd', name: 'D', followersCount: 50000, reason: 'r', fit: 6 },
      { handle: 'e', name: 'E', followersCount: 3000, reason: 'r', fit: 7 },
      { handle: 'f', name: 'F', followersCount: 6000, reason: 'r', fit: 5 },
      { handle: 'g', name: 'G', followersCount: 200000, reason: 'r', fit: 8 },
      { handle: 'h', name: 'H', followersCount: 4500, reason: 'r', fit: 4 },
      { handle: 'i', name: 'I', followersCount: 5100, reason: 'r', fit: 3 },
      { handle: 'j', name: 'J', followersCount: 100000, reason: 'r', fit: 2 },
      { handle: 'k', name: 'K', followersCount: 10, reason: 'r', fit: 10 },
      { handle: 'l', name: 'L', followersCount: 4900, reason: 'r', fit: 1 },
    ];

    // Ground truth computed with the real scorer, not hand-derived numbers.
    const byScoreDesc = raw
      .map((c) => ({ ...c, score: scoreCandidate(c.fit, ownFollowers, c.followersCount) }))
      .sort((x, y) => y.score - x.score);
    const kept = byScoreDesc.slice(0, 10);
    const dropped = byScoreDesc.slice(10);
    expect(dropped).toHaveLength(2);

    const { processor, em } = makeProcessor({
      finder: {
        suggest: jest.fn().mockResolvedValue({
          niche: 'SMM',
          candidates: raw.map(({ handle, reason, fit }) => ({ handle, reason, fit })),
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          inputTokens: 1,
          outputTokens: 1,
          costUsd: 0,
        }),
      },
      verifier: { verify: jest.fn().mockResolvedValue(raw) },
    });

    await processor.process(job());

    expect(em.save).toHaveBeenCalledTimes(1);
    const saved = em.save.mock.calls[0][0] as Array<{ externalId: string; rank: number }>;

    expect(saved).toHaveLength(10);
    saved.forEach((row, index) => {
      expect(row.rank).toBe(index + 1);
      expect(row.externalId).toBe(kept[index].handle);
    });
    expect(saved[0].externalId).toBe(byScoreDesc[0].handle);

    const savedHandles = saved.map((row) => row.externalId);
    for (const worst of dropped) {
      expect(savedHandles).not.toContain(worst.handle);
    }
  });

  it('leaves the previous suggestions in place and fails the run when the save half of the transaction fails', async () => {
    const em = { delete: jest.fn(), save: jest.fn().mockRejectedValue(new Error('connection terminated')), create: jest.fn((_entity, x) => x) };
    const { processor, runsRepo, suggestionsRepo } = makeProcessor({ em });

    await expect(processor.process(job())).rejects.toThrow('connection terminated');

    // The delete and save happened inside the same transaction call, so a save
    // failure means the transaction (and thus the delete within it) rolled back —
    // the non-transactional delete path was never touched either way.
    expect(suggestionsRepo.manager.transaction).toHaveBeenCalledTimes(1);
    expect(suggestionsRepo.delete).not.toHaveBeenCalled();

    expect(runsRepo.update).toHaveBeenLastCalledWith(
      'run-1',
      expect.objectContaining({ status: CompetitorRunStatus.FAILED, errorMessage: 'connection terminated' }),
    );
  });
});
