import { CompetitorsService } from './competitors.service';
import { CompetitorRunStatus } from '../db/entities/competitor-run.entity';
import { AccountPlatform } from '../db/entities/account.entity';

describe('CompetitorsService.getFor', () => {
  const run = {
    id: 'run-1',
    status: CompetitorRunStatus.SUCCESS,
    niche: 'SMM',
    errorMessage: null,
    finishedAt: new Date('2026-09-17T10:00:00Z'),
  };

  it('marks suggestions the user already tracks and links them to their account', async () => {
    const runs = { findLatest: jest.fn().mockResolvedValue(run), isEnabled: () => true } as any;
    const suggestionsRepo = {
      find: jest.fn().mockResolvedValue([
        { externalId: 'rival', name: 'Конкурент', followersCount: 4800, reason: 'Та же тема', fit: 9, rank: 1 },
        { externalId: 'other', name: 'Другой', followersCount: 3000, reason: 'Смежная тема', fit: 6, rank: 2 },
      ]),
    } as any;
    const accountsRepo = {
      // Realistic: accounts store the '@'-prefixed handle, suggestions store it bare.
      find: jest.fn().mockResolvedValue([{ id: 'acc-9', externalId: '@rival', platform: AccountPlatform.TELEGRAM }]),
    } as any;

    const result = await new CompetitorsService(runs, suggestionsRepo, accountsRepo).getFor('acc-1');

    expect(result.enabled).toBe(true);
    expect(result.run).toEqual(
      expect.objectContaining({ status: CompetitorRunStatus.SUCCESS, niche: 'SMM' }),
    );
    expect(result.suggestions[0]).toEqual(
      expect.objectContaining({ externalId: 'rival', alreadyTracked: true, trackedAccountId: 'acc-9' }),
    );
    expect(result.suggestions[1]).toEqual(
      expect.objectContaining({ externalId: 'other', alreadyTracked: false, trackedAccountId: null }),
    );
  });

  it('returns an empty payload when no run has happened yet', async () => {
    const runs = { findLatest: jest.fn().mockResolvedValue(null), isEnabled: () => false } as any;
    const suggestionsRepo = { find: jest.fn().mockResolvedValue([]) } as any;
    const accountsRepo = { find: jest.fn().mockResolvedValue([]) } as any;

    const result = await new CompetitorsService(runs, suggestionsRepo, accountsRepo).getFor('acc-1');

    expect(result).toEqual({ enabled: false, run: null, suggestions: [] });
  });
});
