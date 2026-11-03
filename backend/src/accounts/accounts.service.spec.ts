import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { Account, AccountPlatform, AccountType } from '../db/entities/account.entity';
import { InstagramDiscoveryUnavailableError, InstagramProfileNotFoundError } from '../connectors/instagram/instagram-discovery.errors';
import { Profile } from '../db/entities/profile.entity';

/**
 * Gives a fake repo a manager whose transaction hands out an EntityManager.
 * Account saves are routed to repo.save at call time, so the existing
 * repo.save assertions (and tests that swap repo.save) keep working.
 */
function withTransactions(repo: any) {
  const em = {
    save: jest.fn((target: unknown, row: any) =>
      target === Profile ? Promise.resolve({ id: 'prof-new', ...row }) : repo.save(row),
    ),
    count: jest.fn().mockResolvedValue(1),
    delete: jest.fn(),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    findOneBy: jest.fn().mockResolvedValue({ id: 'prof-1', name: 'Existing' }),
  };
  repo.em = em;
  repo.manager = {
    transaction: jest.fn((cb: (em: unknown) => unknown) => cb(em)),
    findOneBy: em.findOneBy,
  };
  return repo;
}

function makeRepo(saved: unknown = { id: '1' }, existing: unknown = null) {
  return withTransactions({
    save: jest.fn().mockResolvedValue(saved),
    create: jest.fn((x) => x),
    findOneBy: jest.fn().mockResolvedValue(existing),
  });
}

describe('AccountsService', () => {
  it('creates an account with isActive true by default', async () => {
    const saved = { id: '1' };
    const repo = makeRepo(saved);
    const service = new AccountsService(repo, { get: jest.fn() } as any, { createManual: jest.fn() } as any);

    const result = await service.create({
      platform: AccountPlatform.TELEGRAM,
      externalId: '@chan',
      name: 'Chan',
      type: AccountType.OWN,
    });

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: true }),
    );
    expect(result).toBe(saved);
  });

  it('creates a profile named after a manually created account', async () => {
    const repo = makeRepo({ id: 'acc-1' });
    const service = new AccountsService(repo, { get: jest.fn() } as any, { createManual: jest.fn() } as any);

    await service.create({ platform: AccountPlatform.TELEGRAM, externalId: '@chan', name: 'Chan', type: AccountType.OWN });

    expect(repo.em.save).toHaveBeenCalledWith(Profile, { name: 'Chan' });
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'prof-new' }));
  });

  describe('remove', () => {
    it('hides the account and keeps all its data', async () => {
      const repo = { findOneBy: jest.fn().mockResolvedValue({ id: 'acc-1', isActive: true }), update: jest.fn() } as any;
      const service = new AccountsService(repo, { get: jest.fn() } as any, { createManual: jest.fn() } as any);

      await service.remove('acc-1');

      expect(repo.update).toHaveBeenCalledWith('acc-1', { isActive: false });
    });

    it('answers 404 for an account that is already deleted', async () => {
      const repo = { findOneBy: jest.fn().mockResolvedValue(null), update: jest.fn() } as any;
      const service = new AccountsService(repo, { get: jest.fn() } as any, { createManual: jest.fn() } as any);

      await expect(service.remove('acc-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findOneBy).toHaveBeenCalledWith({ id: 'acc-1', isActive: true });
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('preview', () => {
    it('resolves the channel without saving anything', async () => {
      const repo = makeRepo();
      const connector = {
        getAccountInfo: jest.fn().mockResolvedValue({ name: 'Some Channel', avatarUrl: 'file123', description: null }),
        getAccountStats: jest.fn().mockResolvedValue({ followersCount: 4321 }),
        getAvatar: jest.fn().mockResolvedValue({ data: Buffer.from('img'), contentType: 'image/jpeg' }),
      };
      const service = new AccountsService(
        repo,
        { get: jest.fn().mockReturnValue(connector) } as any,
        { createManual: jest.fn() } as any,
      );

      const result = await service.preview('https://t.me/somechannel');

      expect(result).toEqual({
        platform: AccountPlatform.TELEGRAM,
        externalId: '@somechannel',
        name: 'Some Channel',
        followersCount: 4321,
        avatarDataUri: `data:image/jpeg;base64,${Buffer.from('img').toString('base64')}`,
        alreadyAdded: false,
        previouslyAdded: false,
      });
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('still previews when the channel has no photo', async () => {
      const repo = makeRepo();
      const connector = {
        getAccountInfo: jest.fn().mockResolvedValue({ name: 'Some Channel', avatarUrl: null, description: null }),
        getAccountStats: jest.fn().mockResolvedValue({ followersCount: 10 }),
        getAvatar: jest.fn(),
      };
      const service = new AccountsService(
        repo,
        { get: jest.fn().mockReturnValue(connector) } as any,
        { createManual: jest.fn() } as any,
      );

      const result = await service.preview('https://t.me/somechannel');

      expect(result.avatarDataUri).toBeNull();
      expect(connector.getAvatar).not.toHaveBeenCalled();
    });

    it('reports that an already added channel is a duplicate', async () => {
      const repo = makeRepo({ id: '1' }, { id: 'existing', externalId: '@somechannel', isActive: true });
      const connector = {
        getAccountInfo: jest.fn().mockResolvedValue({ name: 'Some Channel', avatarUrl: null, description: null }),
        getAccountStats: jest.fn().mockResolvedValue({ followersCount: 4321 }),
        getAvatar: jest.fn(),
      };
      const service = new AccountsService(
        repo,
        { get: jest.fn().mockReturnValue(connector) } as any,
        { createManual: jest.fn() } as any,
      );

      const result = await service.preview('https://t.me/somechannel');

      expect(result.alreadyAdded).toBe(true);
      expect(result.name).toBe('Some Channel');
    });

    it('reports a channel that is not yet added as addable', async () => {
      const repo = makeRepo();
      const connector = {
        getAccountInfo: jest.fn().mockResolvedValue({ name: 'Some Channel', avatarUrl: null, description: null }),
        getAccountStats: jest.fn().mockResolvedValue({ followersCount: 4321 }),
        getAvatar: jest.fn(),
      };
      const service = new AccountsService(
        repo,
        { get: jest.fn().mockReturnValue(connector) } as any,
        { createManual: jest.fn() } as any,
      );

      const result = await service.preview('https://t.me/somechannel');

      expect(result.alreadyAdded).toBe(false);
    });

    it('still previews the channel when its avatar cannot be downloaded', async () => {
      const repo = makeRepo();
      const connector = {
        getAccountInfo: jest.fn().mockResolvedValue({ name: 'Some Channel', avatarUrl: 'file123', description: null }),
        getAccountStats: jest.fn().mockResolvedValue({ followersCount: 4321 }),
        getAvatar: jest.fn().mockRejectedValue(new Error('file download failed')),
      };
      const service = new AccountsService(
        repo,
        { get: jest.fn().mockReturnValue(connector) } as any,
        { createManual: jest.fn() } as any,
      );

      const result = await service.preview('https://t.me/somechannel');

      expect(result.name).toBe('Some Channel');
      expect(result.followersCount).toBe(4321);
      expect(result.avatarDataUri).toBeNull();
    });

    it('rejects a link it cannot resolve', async () => {
      const repo = makeRepo();
      const service = new AccountsService(
        repo,
        { get: jest.fn() } as any,
        { createManual: jest.fn() } as any,
      );

      await expect(service.preview('https://example.com/x')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('createFromLink', () => {
    it('refuses a link for another network than the field it was typed into', async () => {
      const repo = makeRepo();
      const connector = { getAccountInfo: jest.fn() };
      const service = new AccountsService(repo, { get: jest.fn(() => connector) } as any, { createManual: jest.fn() } as any);

      await expect(service.createFromLink('https://instagram.com/brand', 'prof-1', AccountPlatform.TELEGRAM))
        .rejects.toThrow('Это ссылка не на Telegram');
      expect(connector.getAccountInfo).not.toHaveBeenCalled();
    });

    it('refuses a second account of the same network in one project', async () => {
      const repo = makeRepo();
      repo.findOneBy.mockImplementation((where: any) => Promise.resolve(where.profileId ? { id: 'acc-tg', isActive: true } : null));
      const service = new AccountsService(repo, { get: jest.fn(() => ({ getAccountInfo: jest.fn() })) } as any, { createManual: jest.fn() } as any);

      await expect(service.createFromLink('https://t.me/somechannel', 'prof-1')).rejects.toThrow('В проекте уже есть Telegram');
    });

    it('names the project an already added account belongs to', async () => {
      const repo = makeRepo({ id: '1' }, { id: 'acc-1', profileId: 'prof-7', isActive: true });
      repo.manager.findOneBy.mockResolvedValue({ id: 'prof-7', name: 'Мезопроф' });
      const service = new AccountsService(repo, { get: jest.fn(() => ({})) } as any, { createManual: jest.fn() } as any);

      await expect(service.createFromLink('https://t.me/somechannel')).rejects.toThrow('Этот аккаунт уже в проекте «Мезопроф»');
    });

    it('saves the name and avatar fetched from the platform', async () => {
      const repo = makeRepo();
      const connector = {
        getAccountInfo: jest
          .fn()
          .mockResolvedValue({
            name: 'Some Channel',
            avatarUrl: 'https://cdn/photo.jpg',
            description: null,
          }),
      };
      const service = new AccountsService(repo, {
        get: jest.fn().mockReturnValue(connector),
      } as any, { createManual: jest.fn() } as any);

      await service.createFromLink('https://t.me/somechannel');

      expect(connector.getAccountInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: AccountPlatform.TELEGRAM,
          externalId: '@somechannel',
        }),
      );
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: AccountPlatform.TELEGRAM,
          externalId: '@somechannel',
          name: 'Some Channel',
          avatarUrl: 'https://cdn/photo.jpg',
          type: AccountType.PUBLIC_NO_ACCESS,
          isActive: true,
        }),
      );
    });

    it('puts a new account into a new profile named after it by default', async () => {
      const repo = makeRepo();
      const connector = { getAccountInfo: jest.fn().mockResolvedValue({ name: 'Some Channel', avatarUrl: null, description: null }) };
      const service = new AccountsService(repo, { get: jest.fn().mockReturnValue(connector) } as any, { createManual: jest.fn() } as any);

      await service.createFromLink('https://t.me/somechannel');

      expect(repo.em.save).toHaveBeenCalledWith(Profile, { name: 'Some Channel' });
      expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'prof-new' }));
    });

    it('adds the account to the chosen profile', async () => {
      const repo = makeRepo();
      const connector = { getAccountInfo: jest.fn().mockResolvedValue({ name: 'Some Channel', avatarUrl: null, description: null }) };
      const service = new AccountsService(repo, { get: jest.fn().mockReturnValue(connector) } as any, { createManual: jest.fn() } as any);

      await service.createFromLink('https://t.me/somechannel', 'prof-1');

      expect(repo.em.save).not.toHaveBeenCalledWith(Profile, expect.anything());
      expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'prof-1' }));
    });

    it('refuses an unknown profile before asking the platform', async () => {
      const repo = makeRepo();
      repo.manager.findOneBy.mockResolvedValue(null);
      const connector = { getAccountInfo: jest.fn() };
      const service = new AccountsService(repo, { get: jest.fn().mockReturnValue(connector) } as any, { createManual: jest.fn() } as any);

      await expect(service.createFromLink('https://t.me/somechannel', 'gone')).rejects.toBeInstanceOf(NotFoundException);
      expect(connector.getAccountInfo).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    });

    // The profile can be deleted between the check and the insert; the FK catches it.
    it('maps a foreign-key violation to the same profile 404', async () => {
      const repo = makeRepo();
      repo.save = jest.fn().mockRejectedValue(Object.assign(new Error('fk'), { code: '23503' }));
      const connector = { getAccountInfo: jest.fn().mockResolvedValue({ name: 'Some Channel', avatarUrl: null, description: null }) };
      const service = new AccountsService(repo, { get: jest.fn().mockReturnValue(connector) } as any, { createManual: jest.fn() } as any);

      await expect(service.createFromLink('https://t.me/somechannel', 'prof-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('queues a sync so the new account gets its stats without a manual refresh', async () => {
      const repo = makeRepo({ id: 'acc-9' });
      const connector = {
        getAccountInfo: jest.fn().mockResolvedValue({ name: 'Some Channel', avatarUrl: null, description: null }),
      };
      const syncJobs = { createManual: jest.fn() };
      const service = new AccountsService(
        repo,
        { get: jest.fn().mockReturnValue(connector) } as any,
        syncJobs as any,
      );

      await service.createFromLink('https://t.me/somechannel');

      expect(syncJobs.createManual).toHaveBeenCalledWith('acc-9');
    });

    it('rejects a link that is not a recognised platform URL', async () => {
      const repo = makeRepo();
      const service = new AccountsService(repo, { get: jest.fn() } as any, { createManual: jest.fn() } as any);

      await expect(
        service.createFromLink('https://example.com/someone'),
      ).rejects.toThrow('Не удалось распознать ссылку. Вставьте ссылку на аккаунт, например https://t.me/channel');
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('rejects a platform that has no connector registered yet', async () => {
      const repo = makeRepo();
      const registry = {
        get: jest.fn(() => {
          throw new Error('No connector registered for platform vk');
        }),
      } as any;
      const service = new AccountsService(repo, registry, { createManual: jest.fn() } as any);

      await expect(
        service.createFromLink('https://vk.com/somegroup'),
      ).rejects.toThrow('ВКонтакте пока не поддерживается');
      expect(repo.save).not.toHaveBeenCalled();
    });

    function serviceRejectingWith(error: unknown) {
      const connector = { getAccountInfo: jest.fn().mockRejectedValue(error) };
      return new AccountsService(makeRepo(), {
        get: jest.fn().mockReturnValue(connector),
      } as any, { createManual: jest.fn() } as any);
    }

    it('says the channel was not found for a Telegram 400 "chat not found"', async () => {
      const error = Object.assign(new Error('Request failed with status code 400'), {
        response: { status: 400, data: { ok: false, description: 'Bad Request: chat not found' } },
      });
      await expect(
        serviceRejectingWith(error).createFromLink('https://t.me/nosuchchannel'),
      ).rejects.toThrow(new BadRequestException('Канал не найден'));
    });

    it('says the channel was not found when the error text is "chat not found"', async () => {
      await expect(
        serviceRejectingWith(new Error('Bad Request: chat not found')).createFromLink('https://t.me/nosuchchannel'),
      ).rejects.toThrow(new BadRequestException('Канал не найден'));
    });

    it('asks to retry on a timeout, a 429 or a 5xx, without leaking provider text', async () => {
      const timeout = Object.assign(new Error('timeout of 10000ms exceeded'), { code: 'ECONNABORTED' });
      const limited = Object.assign(new Error('Too Many Requests'), { response: { status: 429 } });
      const broken = Object.assign(new Error('Bad Gateway'), { response: { status: 502 } });
      for (const error of [timeout, limited, broken]) {
        await expect(
          serviceRejectingWith(error).createFromLink('https://t.me/nosuchchannel'),
        ).rejects.toThrow(new BadRequestException('Не удалось проверить, попробуйте ещё раз'));
      }
    });

    it('never appends raw provider text to an unknown failure', async () => {
      await expect(
        serviceRejectingWith(new Error('secret provider detail')).createFromLink('https://t.me/nosuchchannel'),
      ).rejects.toThrow(new BadRequestException('Не удалось проверить аккаунт'));
    });

    it('rejects a link the platform cannot resolve to a real account', async () => {
      const repo = makeRepo();
      const connector = {
        getAccountInfo: jest
          .fn()
          .mockRejectedValue(new Error('chat not found')),
      };
      const service = new AccountsService(repo, {
        get: jest.fn().mockReturnValue(connector),
      } as any, { createManual: jest.fn() } as any);

      await expect(
        service.createFromLink('https://t.me/nosuchchannel'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('Instagram links', () => {
    function setup(opts: { info?: object; infoError?: Error; existing?: (where: any) => unknown } = {}) {
      const repo = withTransactions({
        save: jest.fn((x) => Promise.resolve({ id: 'acc-new', ...x })),
        create: jest.fn((x) => x),
        findOneBy: jest.fn((where) => Promise.resolve(opts.existing ? opts.existing(where) : null)),
      } as any);
      const connector = {
        getAccountInfo: opts.infoError
          ? jest.fn().mockRejectedValue(opts.infoError)
          : jest.fn().mockResolvedValue(opts.info ?? { name: 'Brand', avatarUrl: null, description: null, platformUserId: '9001' }),
        getAccountStats: jest.fn().mockResolvedValue({ followersCount: 5000, followingCount: 10, postsCount: 300 }),
        getAvatar: jest.fn(),
      };
      const registry = { get: jest.fn().mockReturnValue(connector) } as any;
      const syncJobs = { createManual: jest.fn() };
      return { service: new AccountsService(repo, registry, syncJobs as any), repo, connector, syncJobs };
    }

    it('previews a competitor profile, asking the connector as a competitor', async () => {
      const { service, connector } = setup();

      const preview = await service.preview('https://www.instagram.com/brand/');

      expect(preview).toMatchObject({ platform: AccountPlatform.INSTAGRAM, externalId: '@brand', name: 'Brand', followersCount: 5000, alreadyAdded: false });
      expect(connector.getAccountInfo).toHaveBeenCalledWith(
        expect.objectContaining({ externalId: '@brand', type: AccountType.PUBLIC_NO_ACCESS }),
      );
    });

    it('adds the competitor and queues its first sync', async () => {
      const { service, repo, syncJobs } = setup();

      await service.createFromLink('https://instagram.com/brand');

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ platform: AccountPlatform.INSTAGRAM, externalId: '@brand', type: AccountType.PUBLIC_NO_ACCESS }),
      );
      expect(syncJobs.createManual).toHaveBeenCalledWith('acc-new');
    });

    it('asks for a profile link when given a post link', async () => {
      const { service, connector } = setup();

      await expect(service.preview('https://www.instagram.com/p/C1a2B3c4D5/')).rejects.toThrow(
        'Вставьте ссылку на профиль Instagram, а не на пост',
      );
      expect(connector.getAccountInfo).not.toHaveBeenCalled();
    });

    it.each([
      ['not_connected', 'instagram_discovery_not_connected'],
      ['reconnect', 'instagram_discovery_reconnect'],
    ] as const)('returns code %s → %s so the dialog can offer Facebook login', async (reason, code) => {
      const { service } = setup({ infoError: new InstagramDiscoveryUnavailableError(reason) });

      const error = await service.preview('https://instagram.com/brand').catch((e) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual({ message: new InstagramDiscoveryUnavailableError(reason).message, code });
    });

    it('says plainly when the profile is not a business account', async () => {
      const { service } = setup({ infoError: new InstagramProfileNotFoundError() });

      await expect(service.createFromLink('https://instagram.com/someone')).rejects.toThrow(
        'Аккаунт не найден или это не бизнес-аккаунт Instagram',
      );
    });

    it('treats the user\'s own connected account as already added', async () => {
      const own = { id: 'acc-own', externalId: '9001', isActive: true };
      const existing = (where: any) => (where.externalId === '9001' ? own : null);

      const { service } = setup({ existing });
      expect((await service.preview('https://instagram.com/brand')).alreadyAdded).toBe(true);

      const { service: again, repo } = setup({ existing });
      await expect(again.createFromLink('https://instagram.com/brand')).rejects.toBeInstanceOf(ConflictException);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('createFromLink duplicate protection', () => {
    function serviceWith(repo: any, syncJobs = { createManual: jest.fn() }) {
      const connector = {
        getAccountInfo: jest.fn().mockResolvedValue({ name: 'Some Channel', avatarUrl: null, description: null }),
      };
      return {
        service: new AccountsService(repo, { get: jest.fn().mockReturnValue(connector) } as any, syncJobs as any),
        syncJobs,
        connector,
      };
    }

    it('rejects a link for an account that is already added', async () => {
      const repo = makeRepo({ id: '1' }, { id: 'existing', externalId: '@somechannel', isActive: true });
      const { service } = serviceWith(repo);

      await expect(service.createFromLink('https://t.me/somechannel')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('looks the duplicate up by platform and handle together', async () => {
      const repo = makeRepo({ id: '1' }, { id: 'existing', isActive: true });
      const { service } = serviceWith(repo);

      await service.createFromLink('https://t.me/somechannel').catch(() => undefined);

      expect(repo.findOneBy).toHaveBeenCalledWith({
        platform: AccountPlatform.TELEGRAM,
        externalId: '@somechannel',
      });
    });

    it('saves nothing and queues no sync when the account already exists', async () => {
      const repo = makeRepo({ id: '1' }, { id: 'existing', isActive: true });
      const { service, syncJobs } = serviceWith(repo);

      await service.createFromLink('https://t.me/somechannel').catch(() => undefined);

      expect(repo.save).not.toHaveBeenCalled();
      expect(syncJobs.createManual).not.toHaveBeenCalled();
    });

    it('treats the same channel in different case as already added', async () => {
      const repo = makeRepo({ id: '1' }, { id: 'existing', isActive: true });
      const { service } = serviceWith(repo);

      await expect(service.createFromLink('https://t.me/SomeChannel')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(repo.findOneBy).toHaveBeenCalledWith(
        expect.objectContaining({ externalId: '@somechannel' }),
      );
    });

    // Two adds racing past the findOneBy check both reach the insert; the database
    // constraint is what actually stops the second one.
    it('maps a unique violation from the database to the same conflict', async () => {
      const repo = makeRepo();
      repo.save = jest.fn().mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));
      const { service } = serviceWith(repo);

      await expect(service.createFromLink('https://t.me/somechannel')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('does not swallow unrelated database errors as conflicts', async () => {
      const repo = makeRepo();
      repo.save = jest.fn().mockRejectedValue(Object.assign(new Error('disk full'), { code: '53100' }));
      const { service } = serviceWith(repo);

      await expect(service.createFromLink('https://t.me/somechannel')).rejects.toThrow('disk full');
    });
  });

  describe('reviving a deleted account', () => {
    function setup(existing: (where: any) => unknown, affected = 1) {
      const repo = makeRepo();
      repo.findOneBy.mockImplementation((where: any) => Promise.resolve(existing(where)));
      repo.em.update = jest.fn().mockResolvedValue({ affected });
      const connector = {
        getAccountInfo: jest.fn().mockResolvedValue({ name: 'Brand', avatarUrl: null, description: null, platformUserId: '9001' }),
        getAccountStats: jest.fn().mockResolvedValue({ followersCount: 10 }),
        getAvatar: jest.fn(),
      };
      const syncJobs = { createManual: jest.fn() };
      const service = new AccountsService(repo, { get: jest.fn(() => connector) } as any, syncJobs as any);
      return { service, repo, connector, syncJobs };
    }
    const deleted = { id: 'acc-old', name: 'Chan', externalId: '@somechannel', isActive: false, profileId: 'prof-old' };

    it('brings a deleted account back into the chosen project and syncs it', async () => {
      const { service, repo, syncJobs, connector } = setup((w) => (w.externalId === '@somechannel' ? deleted : null));

      const account = await service.createFromLink('https://t.me/somechannel', 'prof-1');

      expect(repo.em.update).toHaveBeenCalledWith(
        Account, { id: 'acc-old', isActive: false }, { isActive: true, profileId: 'prof-1' },
      );
      expect(account).toMatchObject({ id: 'acc-old', isActive: true, profileId: 'prof-1' });
      expect(repo.save).not.toHaveBeenCalled();
      expect(connector.getAccountInfo).not.toHaveBeenCalled();
      expect(syncJobs.createManual).toHaveBeenCalledWith('acc-old');
    });

    it('brings it back into a new project named after it when no project is given', async () => {
      const { service, repo } = setup((w) => (w.externalId === '@somechannel' ? deleted : null));

      await service.createFromLink('https://t.me/somechannel');

      expect(repo.em.save).toHaveBeenCalledWith(Profile, { name: 'Chan' });
      expect(repo.em.update).toHaveBeenCalledWith(Account, expect.anything(), { isActive: true, profileId: 'prof-new' });
    });

    it('keeps it deleted when the project already has that network', async () => {
      const { service, repo } = setup((w) =>
        w.profileId ? { id: 'acc-tg', isActive: true } : w.externalId === '@somechannel' ? deleted : null);

      await expect(service.createFromLink('https://t.me/somechannel', 'prof-1')).rejects.toThrow('В проекте уже есть Telegram');
      expect(repo.em.update).not.toHaveBeenCalled();
    });

    it('answers «already added» when a concurrent add revived it first', async () => {
      const { service, syncJobs } = setup((w) => (w.externalId === '@somechannel' ? deleted : null), 0);

      await expect(service.createFromLink('https://t.me/somechannel', 'prof-1')).rejects.toBeInstanceOf(ConflictException);
      expect(syncJobs.createManual).not.toHaveBeenCalled();
    });

    it('revives a deleted own Instagram account found by its numeric id', async () => {
      const own = { id: 'acc-own', name: 'Brand', externalId: '9001', isActive: false, profileId: 'prof-old' };
      const { service, repo } = setup((w) => (w.externalId === '9001' ? own : null));

      await service.createFromLink('https://instagram.com/brand', 'prof-1');

      expect(repo.em.update).toHaveBeenCalledWith(Account, { id: 'acc-own', isActive: false }, { isActive: true, profileId: 'prof-1' });
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('previews a deleted account as previously added, not as a duplicate', async () => {
      const { service } = setup((w) => (w.externalId === '@somechannel' ? deleted : null));

      const preview = await service.preview('https://t.me/somechannel');

      expect(preview).toMatchObject({ alreadyAdded: false, previouslyAdded: true });
    });

    it('refuses a preview for another network than the field asked for', async () => {
      const { service, connector } = setup(() => null);

      await expect(service.preview('https://vk.com/brand', AccountPlatform.TELEGRAM)).rejects.toThrow('Это ссылка не на Telegram');
      expect(connector.getAccountInfo).not.toHaveBeenCalled();
    });
  });
});
