import { TelegramConnector } from './telegram.connector';
import { AccountPlatform, AccountType } from '../../db/entities/account.entity';

describe('TelegramConnector', () => {
  const account = {
    id: '1',
    platform: AccountPlatform.TELEGRAM,
    externalId: '@testchannel',
    name: 'Test',
    avatarUrl: null,
    type: AccountType.OWN,
    isActive: true,
    createdAt: new Date(),
  };

  it('getAccountStats maps member count to followersCount', async () => {
    const client = { getChatMemberCount: jest.fn().mockResolvedValue(1234), getChat: jest.fn() } as any;
    const connector = new TelegramConnector(client);

    const stats = await connector.getAccountStats(account);

    expect(stats.followersCount).toBe(1234);
    expect(stats.followingCount).toBeNull();
  });

  it('getAccountInfo maps chat title and photo', async () => {
    const client = {
      getChat: jest.fn().mockResolvedValue({ title: 'Test Channel', photoUrl: 'file123' }),
      getChatMemberCount: jest.fn(),
    } as any;
    const connector = new TelegramConnector(client);

    const info = await connector.getAccountInfo(account);

    expect(info.name).toBe('Test Channel');
    expect(info.avatarUrl).toBe('file123');
  });

  it('getPosts returns an empty array (posts arrive via webhook, not pull)', async () => {
    const client = {} as any;
    const connector = new TelegramConnector(client);

    const posts = await connector.getPosts(account, new Date());

    expect(posts).toEqual([]);
  });
});
