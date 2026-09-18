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
    // Account.externalId is stored WITH a leading '@' (see parseAccountLink), and the
    // Telegram Bot API requires it — the bare handle from the model must be re-prefixed.
    expect(connector.getAccountInfo).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: '@rival' }),
    );
    expect(connector.getAccountStats).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: '@rival' }),
    );
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

  it('drops a candidate entirely when stats cannot be fetched, even if info resolved', async () => {
    const connector = {
      getAccountInfo: jest.fn().mockResolvedValue({ name: 'Конкурент', description: null, avatarUrl: null }),
      getAccountStats: jest.fn().mockRejectedValue(new Error('429')),
    };
    const registry = { get: jest.fn().mockReturnValue(connector) } as any;

    const result = await new CompetitorVerifier(registry).verify(
      [{ handle: 'rival', reason: 'Та же тема', fit: 8 }],
      profile,
    );

    expect(result).toEqual([]);
  });

  describe('quality filters', () => {
    const DAY_MS = 24 * 60 * 60 * 1000;

    function connectorWith(overrides: { description?: string | null; latestPostAt?: jest.Mock }) {
      return {
        getAccountInfo: jest
          .fn()
          .mockResolvedValue({ name: 'Конкурент', description: overrides.description ?? null, avatarUrl: null }),
        getAccountStats: jest.fn().mockResolvedValue({ followersCount: 4200 }),
        getLatestPostAt: overrides.latestPostAt ?? jest.fn().mockResolvedValue(new Date()),
      };
    }

    async function verifyWith(connector: object) {
      const registry = { get: jest.fn().mockReturnValue(connector) } as any;
      return new CompetitorVerifier(registry).verify([{ handle: 'rival', reason: 'Та же тема', fit: 8 }], profile);
    }

    it('drops a group (or any chat that is not a channel)', async () => {
      const connector = connectorWith({});
      connector.getAccountInfo.mockResolvedValue({
        name: 'Доктор Вялов | Сергей Вялов',
        description: null,
        avatarUrl: null,
        isChannel: false,
      });

      expect(await verifyWith(connector)).toEqual([]);
      expect(connector.getLatestPostAt).not.toHaveBeenCalled();
    });

    it('drops a channel whose description is a private-invite funnel', async () => {
      const connector = connectorWith({
        description: 'НАШ ЗАКРЫТЫЙ КАНАЛ\nhttps://t.me/+kAwyh79Pg8o3ZDNi\nРЕЗЕРВ https://t.me/+Aq-DRvpQywhkMzUy',
      });

      expect(await verifyWith(connector)).toEqual([]);
      // Spam is decided from the description alone — no need to fetch its posts.
      expect(connector.getLatestPostAt).not.toHaveBeenCalled();
    });

    it('drops a channel whose newest post is older than 90 days', async () => {
      const connector = connectorWith({
        latestPostAt: jest.fn().mockResolvedValue(new Date(Date.now() - 91 * DAY_MS)),
      });

      expect(await verifyWith(connector)).toEqual([]);
      expect(connector.getLatestPostAt).toHaveBeenCalledWith(expect.objectContaining({ externalId: '@rival' }));
    });

    it('keeps a channel that posted within the last 90 days', async () => {
      const connector = connectorWith({
        latestPostAt: jest.fn().mockResolvedValue(new Date(Date.now() - 89 * DAY_MS)),
      });

      expect((await verifyWith(connector)).map((c) => c.handle)).toEqual(['rival']);
    });

    it('drops a channel that has no posts at all', async () => {
      const connector = connectorWith({ latestPostAt: jest.fn().mockResolvedValue('none') });

      expect(await verifyWith(connector)).toEqual([]);
    });

    it('keeps a channel whose activity is unknown (web preview hidden)', async () => {
      const connector = connectorWith({ latestPostAt: jest.fn().mockResolvedValue(null) });

      expect((await verifyWith(connector)).map((c) => c.handle)).toEqual(['rival']);
    });

    it('keeps a channel when the activity check itself fails', async () => {
      const connector = connectorWith({ latestPostAt: jest.fn().mockRejectedValue(new Error('timeout')) });

      expect((await verifyWith(connector)).map((c) => c.handle)).toEqual(['rival']);
    });
  });
});
