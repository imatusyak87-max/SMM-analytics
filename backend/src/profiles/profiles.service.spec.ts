import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Account } from '../db/entities/account.entity';
import { Profile } from '../db/entities/profile.entity';
import { ProfilesService } from './profiles.service';

const overviewItem = (id: string, profileId: string, followers: number) =>
  ({
    account: { id, profileId },
    latestSnapshot: { followersCount: followers },
  }) as any;

function setup({
  profiles = [
    { id: 'p1', name: 'One' },
    { id: 'p2', name: 'Two' },
    { id: 'p3', name: 'Inactive only' },
  ],
  overview = [
    overviewItem('a1', 'p1', 10),
    overviewItem('a2', 'p2', 5),
    overviewItem('a3', 'p2', 7),
  ],
  account = { id: 'a2', name: 'Acc', profileId: 'p2' },
  target = { id: 'p1', name: 'One' },
  remaining = 0,
} = {}) {
  const em = {
    findOneBy: jest.fn((entity: unknown) =>
      Promise.resolve(entity === Account ? account : target),
    ),
    save: jest.fn((_t: unknown, row: object) =>
      Promise.resolve({ id: 'p-new', ...row }),
    ),
    update: jest.fn(),
    count: jest.fn().mockResolvedValue(remaining),
    delete: jest.fn(),
  };
  const profilesRepo = {
    find: jest.fn().mockResolvedValue(profiles),
    findOneBy: jest.fn(({ id }: { id: string }) =>
      Promise.resolve(profiles.find((p) => p.id === id) ?? null),
    ),
    save: jest.fn((p: object) => Promise.resolve(p)),
  } as any;
  const accountsRepo = {
    manager: { transaction: jest.fn((cb: (e: unknown) => unknown) => cb(em)) },
  } as any;
  const stats = {
    getOverview: jest.fn((profileId?: string) =>
      Promise.resolve(
        overview.filter((i) => !profileId || i.account.profileId === profileId),
      ),
    ),
  } as any;
  return {
    service: new ProfilesService(profilesRepo, accountsRepo, stats),
    em,
    profilesRepo,
    stats,
  };
}

describe('ProfilesService.list', () => {
  it('groups active accounts under their profiles and skips profiles with none', async () => {
    const { service, profilesRepo } = setup();

    const result = await service.list();

    expect(profilesRepo.find).toHaveBeenCalledWith({
      order: { createdAt: 'ASC' },
    });
    expect(
      result.map((p) => [
        p.id,
        p.totalFollowers,
        p.accounts.map((a) => a.account.id),
      ]),
    ).toEqual([
      ['p1', 10, ['a1']],
      ['p2', 12, ['a3', 'a2']],
    ]);
  });
});

describe('ProfilesService.get', () => {
  it('returns one profile with its accounts', async () => {
    const { service, stats } = setup();

    const result = await service.get('p2');

    expect(stats.getOverview).toHaveBeenCalledWith('p2');
    expect(result).toMatchObject({ id: 'p2', name: 'Two', totalFollowers: 12 });
  });

  it('404s for a missing profile', async () => {
    const { service } = setup();
    await expect(service.get('nope')).rejects.toThrow(
      new NotFoundException('Профиль не найден'),
    );
  });
});

describe('ProfilesService.rename', () => {
  it('saves a trimmed name', async () => {
    const { service, profilesRepo } = setup();

    await service.rename('p1', '  Coffee Lab  ');

    expect(profilesRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1', name: 'Coffee Lab' }),
    );
  });

  it('rejects a blank name', async () => {
    const { service, profilesRepo } = setup();

    await expect(service.rename('p1', '   ')).rejects.toThrow(
      new BadRequestException('Название профиля не может быть пустым'),
    );
    expect(profilesRepo.save).not.toHaveBeenCalled();
  });

  it('404s for a missing profile', async () => {
    const { service } = setup();
    await expect(service.rename('nope', 'X')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('ProfilesService.moveAccount', () => {
  it('moves the account and removes the profile it left empty', async () => {
    const { service, em } = setup({ remaining: 0 });

    const result = await service.moveAccount('a2', { profileId: 'p1' });

    expect(em.update).toHaveBeenCalledWith(
      Account,
      { id: 'a2' },
      { profileId: 'p1' },
    );
    expect(em.delete).toHaveBeenCalledWith(Profile, { id: 'p2' });
    expect(result).toEqual({ profileId: 'p1' });
  });

  it('keeps the old profile while it still has accounts', async () => {
    const { service, em } = setup({ remaining: 1 });

    await service.moveAccount('a2', { profileId: 'p1' });

    expect(em.delete).not.toHaveBeenCalled();
  });

  it('splits the account into a new profile named after it', async () => {
    const { service, em } = setup({ remaining: 1 });

    const result = await service.moveAccount('a2', { newProfile: true });

    expect(em.save).toHaveBeenCalledWith(Profile, { name: 'Acc' });
    expect(em.update).toHaveBeenCalledWith(
      Account,
      { id: 'a2' },
      { profileId: 'p-new' },
    );
    expect(result).toEqual({ profileId: 'p-new' });
  });

  it('does nothing when the account is already in that profile', async () => {
    const { service, em } = setup();

    const result = await service.moveAccount('a2', { profileId: 'p2' });

    expect(em.update).not.toHaveBeenCalled();
    expect(result).toEqual({ profileId: 'p2' });
  });

  it('404s for a missing account', async () => {
    const { service } = setup({ account: null });
    await expect(
      service.moveAccount('gone', { profileId: 'p1' }),
    ).rejects.toThrow(new NotFoundException('Аккаунт не найден'));
  });

  it('404s for a missing target profile', async () => {
    const { service, em } = setup({ target: null });

    await expect(
      service.moveAccount('a2', { profileId: 'gone' }),
    ).rejects.toThrow(new NotFoundException('Профиль не найден'));
    expect(em.update).not.toHaveBeenCalled();
  });

  it.each([
    [{}],
    [{ profileId: 'p1', newProfile: true }],
    [{ newProfile: false }],
  ])('needs exactly one destination (%j)', async (target) => {
    const { service } = setup();
    await expect(service.moveAccount('a2', target)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
