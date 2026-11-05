import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Account } from '../db/entities/account.entity';
import { AccountPlatform } from '../db/entities/account.entity';
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
  account = {
    id: 'a2',
    name: 'Acc',
    profileId: 'p2',
    platform: 'telegram',
  } as { id: string; name: string; profileId: string; platform: string } | null,
  sameNetwork = null as { id: string } | null,
  target = { id: 'p1', name: 'One' } as { id: string; name: string } | null,
  remaining = 0,
} = {}) {
  const em = {
    findOneBy: jest.fn((entity: unknown, where: any) =>
      Promise.resolve(
        entity !== Account
          ? target
          : where.profileId
            ? sameNetwork
            : account,
      ),
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
    save: jest.fn((p: object) => Promise.resolve({ id: 'p-new', ...p })),
    manager: { transaction: jest.fn((cb: (e: unknown) => unknown) => cb(em)) },
  } as any;
  const accounts = { remove: jest.fn(), createFromLink: jest.fn() };
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
    service: new ProfilesService(profilesRepo, accountsRepo, stats, accounts as any),
    em,
    accounts,
    profilesRepo,
    stats,
  };
}

describe('ProfilesService.list', () => {
  it('groups accounts under their profiles', async () => {
    const { service, profilesRepo } = setup();

    const result = await service.list();

    expect(profilesRepo.find).toHaveBeenCalledWith({
      where: { isActive: true },
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
      ['p3', null, []],
    ]);
  });

  it('lists every project, including one with no accounts', async () => {
    const { service } = setup();
    const list = await service.list();
    expect(list.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(list[2].accounts).toEqual([]);
  });
});

describe('ProfilesService.remove', () => {
  it('hides a deleted project and its accounts, keeping their data', async () => {
    const { service, accounts, em } = setup();
    await service.remove('p2');
    expect(em.update).toHaveBeenCalledWith(Account, { profileId: 'p2' }, { isActive: false });
    expect(em.update).toHaveBeenCalledWith(Profile, { id: 'p2' }, { isActive: false });
    expect(accounts.remove).not.toHaveBeenCalled();
  });

  it('answers 404 for deleting an unknown project', async () => {
    const { service, accounts } = setup();
    await expect(service.remove('nope')).rejects.toBeInstanceOf(NotFoundException);
    expect(accounts.remove).not.toHaveBeenCalled();
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
      new NotFoundException('Проект не найден'),
    );
  });

  it('answers 404 for a hidden project', async () => {
    const { service, profilesRepo } = setup();
    profilesRepo.findOneBy.mockResolvedValue(null);
    await expect(service.get('p1')).rejects.toThrow('Проект не найден');
    expect(profilesRepo.findOneBy).toHaveBeenCalledWith({ id: 'p1', isActive: true });
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
      new BadRequestException('Название проекта не может быть пустым'),
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
  it('moves the account and keeps the project it left, even when empty', async () => {
    const { service, em } = setup({ remaining: 0 });

    const result = await service.moveAccount('a2', { profileId: 'p1' });

    expect(em.update).toHaveBeenCalledWith(
      Account,
      { id: 'a2' },
      { profileId: 'p1' },
    );
    expect(em.delete).not.toHaveBeenCalled();
    expect(result).toEqual({ profileId: 'p1' });
  });

  it('keeps the old profile while it still has accounts', async () => {
    const { service, em } = setup({ remaining: 1 });

    await service.moveAccount('a2', { profileId: 'p1' });

    expect(em.delete).not.toHaveBeenCalled();
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
    ).rejects.toThrow(new NotFoundException('Проект не найден'));
    expect(em.update).not.toHaveBeenCalled();
  });

  it('refuses to move a deleted account', async () => {
    const { service, em } = setup({ account: null });

    await expect(
      service.moveAccount('a2', { profileId: 'p1' }),
    ).rejects.toThrow(new NotFoundException('Аккаунт не найден'));
    expect(em.findOneBy).toHaveBeenCalledWith(Account, {
      id: 'a2',
      isActive: true,
    });
  });

  it('refuses a project that already has that network', async () => {
    const { service, em } = setup({ sameNetwork: { id: 'a9' } });

    await expect(
      service.moveAccount('a2', { profileId: 'p1' }),
    ).rejects.toThrow(new ConflictException('В проекте уже есть Telegram'));
    expect(em.findOneBy).toHaveBeenCalledWith(Account, {
      profileId: 'p1',
      platform: 'telegram',
      isActive: true,
    });
    expect(em.update).not.toHaveBeenCalled();
  });
});

describe('ProfilesService.create', () => {
  it('creates the project and adds every link that resolves, reporting the rest', async () => {
    const { service, accounts } = setup();
    accounts.createFromLink.mockImplementation((link: string) =>
      link.includes('t.me')
        ? Promise.reject(new BadRequestException('Канал не найден'))
        : Promise.resolve({ id: 'acc-ig' }));

    const result = await service.create({ name: '  Pheromone ', links: { instagram: 'https://instagram.com/ph', telegram: 'https://t.me/ph_channel' } });

    expect(result.profile).toMatchObject({ id: 'p-new', name: 'Pheromone' });
    expect(accounts.createFromLink).toHaveBeenCalledWith('https://instagram.com/ph', 'p-new', 'instagram');
    expect(accounts.createFromLink).toHaveBeenCalledWith('https://t.me/ph_channel', 'p-new', 'telegram');
    expect(result.added).toEqual([{ id: 'acc-ig' }]);
    expect(result.failed).toEqual([{ platform: 'telegram', message: 'Канал не найден' }]);
  });

  it('creates a project with no links', async () => {
    const { service, accounts } = setup();
    const result = await service.create({ name: 'Мезопроф' });
    expect(result).toMatchObject({ profile: { name: 'Мезопроф' }, added: [], failed: [] });
    expect(accounts.createFromLink).not.toHaveBeenCalled();
  });

  it('skips blank link fields', async () => {
    const { service, accounts } = setup();
    await service.create({ name: 'X', links: { telegram: '   ' } });
    expect(accounts.createFromLink).not.toHaveBeenCalled();
  });

  it('refuses an empty name and creates nothing', async () => {
    const { service, profilesRepo } = setup();
    await expect(service.create({ name: '   ' })).rejects.toThrow('Название проекта не может быть пустым');
    expect(profilesRepo.save).not.toHaveBeenCalled();
  });

  it('reports an unexpected failure with a generic retry message', async () => {
    const { service, accounts } = setup();
    accounts.createFromLink.mockRejectedValue(new Error('socket hang up'));
    const result = await service.create({ name: 'X', links: { telegram: 'https://t.me/abcde' } });
    expect(result.failed).toEqual([{ platform: 'telegram', message: 'Не удалось проверить, попробуйте ещё раз' }]);
  });
});

describe('ProfilesService.addAccount', () => {
  it('adds a link to an existing project', async () => {
    const { service, accounts } = setup();
    accounts.createFromLink.mockResolvedValue({ id: 'acc-new' });
    expect(await service.addAccount('p1', 'https://t.me/abcde')).toEqual({ id: 'acc-new' });
    expect(accounts.createFromLink).toHaveBeenCalledWith('https://t.me/abcde', 'p1', undefined);
  });

  it('enforces the network of the tile it was added from', async () => {
    const { service, accounts } = setup();
    accounts.createFromLink.mockResolvedValue({ id: 'acc-new' });
    await service.addAccount('p1', 'https://t.me/abcde', AccountPlatform.INSTAGRAM);
    expect(accounts.createFromLink).toHaveBeenCalledWith('https://t.me/abcde', 'p1', AccountPlatform.INSTAGRAM);
  });

  it('answers 404 for an unknown project', async () => {
    const { service } = setup();
    await expect(service.addAccount('nope', 'https://t.me/abcde')).rejects.toBeInstanceOf(NotFoundException);
  });
});
