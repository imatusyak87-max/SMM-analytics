import { CompetitorsProcessor } from './competitors.processor';
import { CompetitorRunStatus } from '../db/entities/competitor-run.entity';
import { CompetitorSuggestion } from '../db/entities/competitor-suggestion.entity';

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
  const suggestionsRepo = { delete: jest.fn(), save: jest.fn(), create: jest.fn((x) => x) };
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
  return { processor, runsRepo, suggestionsRepo, finder, verifier };
}

const job = (attemptsMade = 1) =>
  ({ data: { runId: 'run-1', accountId: 'acc-1' }, opts: { attempts: 2 }, attemptsMade }) as any;

describe('CompetitorsProcessor', () => {
  it('stores verified suggestions, the niche and the usage of a successful run', async () => {
    const { processor, runsRepo, suggestionsRepo } = makeProcessor();

    await processor.process(job());

    expect(suggestionsRepo.delete).toHaveBeenCalledWith({ accountId: 'acc-1' });
    expect(suggestionsRepo.save).toHaveBeenCalledWith([
      expect.objectContaining({ externalId: 'rival', name: 'Конкурент', followersCount: 4800, rank: 1, fit: 9 }),
    ]);
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
    const { processor, suggestionsRepo } = makeProcessor({
      finder: { suggest: jest.fn().mockRejectedValue(new Error('Превышен лимит запросов, попробуйте позже')) },
    });

    await expect(processor.process(job())).rejects.toThrow('Превышен лимит запросов');

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
    const { processor, runsRepo, suggestionsRepo } = makeProcessor({
      verifier: { verify: jest.fn().mockResolvedValue([]) },
    });

    await processor.process(job());

    expect(suggestionsRepo.save).not.toHaveBeenCalled();
    expect(runsRepo.update).toHaveBeenLastCalledWith(
      'run-1',
      expect.objectContaining({ status: CompetitorRunStatus.SUCCESS, candidatesVerified: 0 }),
    );
  });
});
