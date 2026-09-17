import { CompetitorVerifier } from './competitor-verifier.service';
import { ChannelProfile } from './competitor-finder';

const profile: ChannelProfile = {
  handle: 'mychannel',
  title: 'Мой канал',
  followersCount: 5000,
  description: null,
  captions: [],
};

describe('CompetitorVerifier', () => {
  it('keeps channels Telegram confirms, using Telegram follower counts', async () => {
    const connector = {
      getAccountInfo: jest.fn().mockResolvedValue({ name: 'Конкурент', description: null, avatarUrl: null }),
      getAccountStats: jest.fn().mockResolvedValue({ followersCount: 4200 }),
    };
    const registry = { get: jest.fn().mockReturnValue(connector) } as any;

    const result = await new CompetitorVerifier(registry).verify(
      [{ handle: 'rival', reason: 'Та же тема', fit: 8 }],
      profile,
    );

    expect(result).toEqual([
      { handle: 'rival', name: 'Конкурент', followersCount: 4200, reason: 'Та же тема', fit: 8 },
    ]);
  });

  it('drops handles Telegram does not resolve', async () => {
    const connector = {
      getAccountInfo: jest.fn().mockRejectedValue(new Error('chat not found')),
      getAccountStats: jest.fn(),
    };
    const registry = { get: jest.fn().mockReturnValue(connector) } as any;

    const result = await new CompetitorVerifier(registry).verify(
      [{ handle: 'ghost', reason: 'Нет такого', fit: 9 }],
      profile,
    );

    expect(result).toEqual([]);
  });

  it('drops the analysed channel itself and duplicate handles', async () => {
    const connector = {
      getAccountInfo: jest.fn().mockResolvedValue({ name: 'Конкурент', description: null, avatarUrl: null }),
      getAccountStats: jest.fn().mockResolvedValue({ followersCount: 4200 }),
    };
    const registry = { get: jest.fn().mockReturnValue(connector) } as any;

    const result = await new CompetitorVerifier(registry).verify(
      [
        { handle: 'mychannel', reason: 'Это мы сами', fit: 10 },
        { handle: 'rival', reason: 'Та же тема', fit: 8 },
        { handle: 'rival', reason: 'Дубликат', fit: 7 },
      ],
      profile,
    );

    expect(result.map((c) => c.handle)).toEqual(['rival']);
  });
});
