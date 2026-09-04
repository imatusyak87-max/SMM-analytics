import { BadRequestException } from '@nestjs/common';
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
    const service = new AccountsService(repo, { get: jest.fn() } as any);

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

  describe('createFromLink', () => {
    it('saves the name and avatar fetched from the platform', async () => {
      const repo = makeRepo();
      const connector = {
        getAccountInfo: jest
          .fn()
          .mockResolvedValue({
            name: 'FD Agency | SMM',
            avatarUrl: 'https://cdn/photo.jpg',
          }),
      };
      const service = new AccountsService(repo, {
        get: jest.fn().mockReturnValue(connector),
      } as any);

      await service.createFromLink('https://t.me/fedulovadigital');

      expect(connector.getAccountInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: AccountPlatform.TELEGRAM,
          externalId: '@fedulovadigital',
        }),
      );
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: AccountPlatform.TELEGRAM,
          externalId: '@fedulovadigital',
          name: 'FD Agency | SMM',
          avatarUrl: 'https://cdn/photo.jpg',
          type: AccountType.PUBLIC_NO_ACCESS,
          isActive: true,
        }),
      );
    });

    it('rejects a link that is not a recognised platform URL', async () => {
      const repo = makeRepo();
      const service = new AccountsService(repo, { get: jest.fn() } as any);

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
      const service = new AccountsService(repo, registry);

      await expect(
        service.createFromLink('https://vk.com/somegroup'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
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
      } as any);

      await expect(
        service.createFromLink('https://t.me/nosuchchannel'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });
});
