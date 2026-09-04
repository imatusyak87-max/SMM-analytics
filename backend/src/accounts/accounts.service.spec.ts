import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { AccountPlatform, AccountType } from '../db/entities/account.entity';

function makeRepo(saved: unknown = { id: '1' }) {
  return {
    save: jest.fn().mockResolvedValue(saved),
    create: jest.fn((x) => x),
  } as any;
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

  describe('remove', () => {
    function makeRepoWithTransaction(account: unknown) {
      const em = { delete: jest.fn() };
      const repo = {
        findOneBy: jest.fn().mockResolvedValue(account),
        manager: {
          transaction: jest.fn((cb: (em: unknown) => Promise<void>) => cb(em)),
        },
      } as any;
      return { repo, em };
    }

    it('clears the data belonging to the account before removing it', async () => {
      const { repo, em } = makeRepoWithTransaction({ id: 'acc-1' });
      const service = new AccountsService(repo, { get: jest.fn() } as any, { createManual: jest.fn() } as any);

      await service.remove('acc-1');

      const deletedTables = em.delete.mock.calls.map(
        (call: unknown[]) => (call[0] as { name: string }).name,
      );
      expect(deletedTables).toEqual([
        'Post',
        'AccountSnapshot',
        'SyncJob',
        'AccountCredential',
        'Account',
      ]);
      expect(em.delete).toHaveBeenCalledWith(expect.anything(), {
        accountId: 'acc-1',
      });
    });

    it('does not delete anything for an account that does not exist', async () => {
      const { repo, em } = makeRepoWithTransaction(null);
      const service = new AccountsService(repo, { get: jest.fn() } as any, { createManual: jest.fn() } as any);

      await expect(service.remove('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(em.delete).not.toHaveBeenCalled();
    });
  });

  describe('preview', () => {
    it('resolves the channel without saving anything', async () => {
      const repo = makeRepo();
      const connector = {
        getAccountInfo: jest.fn().mockResolvedValue({ name: 'Some Channel', avatarUrl: 'file123' }),
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
      });
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('still previews when the channel has no photo', async () => {
      const repo = makeRepo();
      const connector = {
        getAccountInfo: jest.fn().mockResolvedValue({ name: 'Some Channel', avatarUrl: null }),
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
    it('saves the name and avatar fetched from the platform', async () => {
      const repo = makeRepo();
      const connector = {
        getAccountInfo: jest
          .fn()
          .mockResolvedValue({
            name: 'Some Channel',
            avatarUrl: 'https://cdn/photo.jpg',
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

    it('queues a sync so the new account gets its stats without a manual refresh', async () => {
      const repo = makeRepo({ id: 'acc-9' });
      const connector = {
        getAccountInfo: jest.fn().mockResolvedValue({ name: 'Some Channel', avatarUrl: null }),
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
      ).rejects.toBeInstanceOf(BadRequestException);
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
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('surfaces why the platform rejected the account, not just that it failed', async () => {
      const repo = makeRepo();
      const connector = {
        getAccountInfo: jest
          .fn()
          .mockRejectedValue(new Error('Bad Request: chat not found')),
      };
      const service = new AccountsService(repo, {
        get: jest.fn().mockReturnValue(connector),
      } as any, { createManual: jest.fn() } as any);

      await expect(
        service.createFromLink('https://t.me/nosuchchannel'),
      ).rejects.toThrow(/chat not found/);
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
});
