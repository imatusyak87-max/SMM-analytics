import { CompetitorProfileService } from './competitor-profile.service';
import { AccountPlatform } from '../db/entities/account.entity';

describe('CompetitorProfileService', () => {
  const account = { id: 'acc-1', platform: AccountPlatform.TELEGRAM, externalId: '@mychannel', name: 'Мой канал' } as any;

  it('builds a profile from the connector info and the 30 newest captions', async () => {
    const connector = {
      getAccountInfo: jest.fn().mockResolvedValue({ name: 'Мой канал', description: 'Про SMM', avatarUrl: null }),
      getAccountStats: jest.fn().mockResolvedValue({ followersCount: 5000 }),
    };
    const registry = { get: jest.fn().mockReturnValue(connector) } as any;
    const postsRepo = {
      find: jest.fn().mockResolvedValue([{ caption: 'Первый' }, { caption: null }, { caption: 'Второй' }]),
    } as any;

    const profile = await new CompetitorProfileService(registry, postsRepo).build(account);

    expect(profile).toEqual({
      handle: 'mychannel',
      title: 'Мой канал',
      followersCount: 5000,
      description: 'Про SMM',
      captions: ['Первый', 'Второй'],
    });
    expect(postsRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { accountId: 'acc-1' }, order: { publishedAt: 'DESC' }, take: 30 }),
    );
  });

  it('still builds a profile when stats cannot be fetched', async () => {
    const connector = {
      getAccountInfo: jest.fn().mockResolvedValue({ name: 'Мой канал', description: null, avatarUrl: null }),
      getAccountStats: jest.fn().mockRejectedValue(new Error('429')),
    };
    const registry = { get: jest.fn().mockReturnValue(connector) } as any;
    const postsRepo = { find: jest.fn().mockResolvedValue([]) } as any;

    const profile = await new CompetitorProfileService(registry, postsRepo).build(account);

    expect(profile.followersCount).toBe(0);
    expect(profile.captions).toEqual([]);
  });
});
