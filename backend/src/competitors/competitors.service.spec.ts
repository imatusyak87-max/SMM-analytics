import { CompetitorsService } from './competitors.service';
import { CompetitorRunStatus } from '../db/entities/competitor-run.entity';
import { AccountPlatform } from '../db/entities/account.entity';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const noRejections = { find: jest.fn().mockResolvedValue([]) } as any;

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

    const result = await new CompetitorsService(runs, suggestionsRepo, accountsRepo, noRejections).getFor('acc-1');

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

    const result = await new CompetitorsService(runs, suggestionsRepo, accountsRepo, noRejections).getFor('acc-1');

    expect(result).toEqual({ enabled: false, run: null, suggestions: [] });
  });
});

describe('CompetitorsService: «Не конкурент»', () => {
  const runs = { findLatest: jest.fn().mockResolvedValue(null), isEnabled: () => true } as any;

  function make(account: unknown = { id: 'acc-1' }) {
    const suggestionsRepo = {
      find: jest.fn().mockResolvedValue([
        { externalId: 'rival', name: 'Конкурент', followersCount: 4800, reason: 'r', fit: 9, rank: 1 },
        { externalId: 'wrong', name: 'Не то', followersCount: 3000, reason: 'r', fit: 6, rank: 2 },
      ]),
    } as any;
    const accountsRepo = { find: jest.fn().mockResolvedValue([]), findOneBy: jest.fn().mockResolvedValue(account) } as any;
    const rejectionsRepo = {
      find: jest.fn().mockResolvedValue([{ externalId: 'wrong' }]),
      upsert: jest.fn(),
      delete: jest.fn(),
    } as any;
    return { service: new CompetitorsService(runs, suggestionsRepo, accountsRepo, rejectionsRepo), rejectionsRepo };
  }

  it('leaves rejected channels out of the list', async () => {
    const { service, rejectionsRepo } = make();

    const result = await service.getFor('acc-1');

    expect(result.suggestions.map((s) => s.externalId)).toEqual(['rival']);
    expect(rejectionsRepo.find).toHaveBeenCalledWith({ where: { accountId: 'acc-1' } });
  });

  it('records a rejection once, however many times it is sent', async () => {
    const { service, rejectionsRepo } = make();

    await service.reject('acc-1', 'Wrong');

    // Stored the way suggestions store handles: bare and lowercased.
    expect(rejectionsRepo.upsert).toHaveBeenCalledWith({ accountId: 'acc-1', externalId: 'wrong' }, [
      'accountId',
      'externalId',
    ]);
  });

  it('undoes a rejection', async () => {
    const { service, rejectionsRepo } = make();

    await service.unreject('acc-1', 'wrong');

    expect(rejectionsRepo.delete).toHaveBeenCalledWith({ accountId: 'acc-1', externalId: 'wrong' });
  });

  it('refuses an unknown account', async () => {
    const { service, rejectionsRepo } = make(null);

    await expect(service.reject('missing', 'wrong')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.unreject('missing', 'wrong')).rejects.toBeInstanceOf(NotFoundException);
    expect(rejectionsRepo.upsert).not.toHaveBeenCalled();
    expect(rejectionsRepo.delete).not.toHaveBeenCalled();
  });

  it('refuses something that is not a Telegram username', async () => {
    const { service, rejectionsRepo } = make();

    for (const bad of ['ab', 'has space', 'x'.repeat(33), '../etc']) {
      await expect(service.reject('acc-1', bad)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(rejectionsRepo.upsert).not.toHaveBeenCalled();
  });
});
