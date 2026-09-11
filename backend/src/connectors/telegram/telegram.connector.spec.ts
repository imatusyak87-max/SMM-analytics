import { Logger } from '@nestjs/common';
import { TelegramConnector } from './telegram.connector';
import { AccountPlatform, AccountType } from '../../db/entities/account.entity';
import { PostType } from '../../db/entities/post.entity';
import { PreviewUnavailableError } from './telegram-preview.parser';

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
    const client = {
      getChatMemberCount: jest.fn().mockResolvedValue(1234),
      getChat: jest.fn(),
    } as any;
    const connector = new TelegramConnector(client, {} as any);

    const stats = await connector.getAccountStats(account);

    expect(stats.followersCount).toBe(1234);
    expect(stats.followingCount).toBeNull();
  });

  it('getAccountInfo maps chat title and photo', async () => {
    const client = {
      getChat: jest
        .fn()
        .mockResolvedValue({ title: 'Test Channel', photoUrl: 'file123' }),
      getChatMemberCount: jest.fn(),
    } as any;
    const connector = new TelegramConnector(client, {} as any);

    const info = await connector.getAccountInfo(account);

    expect(info.name).toBe('Test Channel');
    expect(info.avatarUrl).toBe('file123');
  });

  it('getAvatar downloads the photo the file reference points at', async () => {
    const client = {
      downloadFile: jest
        .fn()
        .mockResolvedValue({
          data: Buffer.from('bytes'),
          contentType: 'image/jpeg',
        }),
    } as any;
    const connector = new TelegramConnector(client, {} as any);

    const avatar = await connector.getAvatar('file123');

    expect(client.downloadFile).toHaveBeenCalledWith('file123');
    expect(avatar.contentType).toBe('image/jpeg');
  });
});

// Real preview pages render oldest post first; these fixtures follow that order.
function page(ids: number[], date: string): string {
  const blocks = ids
    .map(
      (id) => `
    <div class="tgme_widget_message" data-post="testchannel/${id}">
      <div class="tgme_widget_message_text">post ${id}</div>
      <span class="tgme_widget_message_views">100</span>
      <time datetime="${date}"></time>
    </div>`,
    )
    .join('');
  return `<section>${blocks}</section>`;
}

// A single post's embed page, as t.me/<channel>/<id>?embed=1 serves it. data-view
// carries the post id, with a trailing "g" for one part of an album.
function embed(id: number, date: string, album = false): string {
  const view = Buffer.from(
    JSON.stringify({ c: -1, p: album ? `${id}g` : id }),
  ).toString('base64');
  return `
    <div class="tgme_widget_message" data-post="testchannel/${id}" data-view="${view}">
      <span class="tgme_widget_message_views">100</span>
      <time datetime="${date}"></time>
    </div>`;
}

const POST_NOT_FOUND =
  '<div class="tgme_widget_message_error">Post not found</div>';

// A channel with its web preview disabled: t.me/s/ holds no posts, but every
// post id in `embeds` still has an embed page. Any other id is "Post not found".
function hiddenChannel(embeds: Record<number, string>) {
  return {
    fetchPage: jest
      .fn()
      .mockRejectedValue(
        new PreviewUnavailableError('channel disabled its preview'),
      ),
    fetchEmbed: jest.fn((_channel: string, id: string) =>
      Promise.resolve(embeds[Number(id)] ?? POST_NOT_FOUND),
    ),
  };
}

// Posts 1..count, one per day ending on 2026-09-09, so post N is dated
// 2026-09-09 minus (count - N) days.
function dailyPosts(
  count: number,
  skip: number[] = [],
): Record<number, string> {
  const embeds: Record<number, string> = {};
  for (let id = 1; id <= count; id++) {
    if (skip.includes(id)) continue;
    const date = new Date(Date.UTC(2026, 8, 9 - (count - id), 12));
    embeds[id] = embed(id, date.toISOString());
  }
  return embeds;
}

const ids = (posts: { externalPostId: string }[]) =>
  posts.map((p) => Number(p.externalPostId)).sort((a, b) => a - b);

describe('TelegramConnector.getPosts on a channel that disabled its web preview', () => {
  const account = { externalId: '@testchannel' } as any;

  it('reads the posts inside the window from their embed pages', async () => {
    const preview = hiddenChannel(dailyPosts(20));
    const connector = new TelegramConnector({} as any, preview as any, 0);

    // Post 20 is dated 2026-09-09, so the window from 2026-09-05 holds posts 16–20.
    const posts = await connector.getPosts(
      account,
      new Date('2026-09-05T00:00:00Z'),
    );

    expect(ids(posts)).toEqual([16, 17, 18, 19, 20]);
    expect(posts.find((p) => p.externalPostId === '20')?.views).toBe(100);
  });

  // The newest id is found by probing; a deleted post sitting exactly where the
  // search probes (512 is a power of two) must not make it stop short of the end.
  it('finds the newest post even when deleted posts sit where the search probes', async () => {
    const preview = hiddenChannel(dailyPosts(842, [512, 575, 800, 841]));
    const connector = new TelegramConnector({} as any, preview as any, 0);

    const posts = await connector.getPosts(
      account,
      new Date('2026-09-05T00:00:00Z'),
    );

    // Posts 838–842 fall in the window; 841 was deleted.
    expect(ids(posts)).toEqual([838, 839, 840, 842]);
  });

  it('keeps walking past deleted posts inside the window', async () => {
    const preview = hiddenChannel(dailyPosts(20, [17, 18]));
    const connector = new TelegramConnector({} as any, preview as any, 0);

    const posts = await connector.getPosts(
      account,
      new Date('2026-09-05T00:00:00Z'),
    );

    expect(ids(posts)).toEqual([16, 19, 20]);
  });

  // Each part of an album has its own embed page repeating the album's numbers.
  // The preview page shows the album once, under its lowest id — so must we.
  it('counts an album once, under its lowest id', async () => {
    const embeds = dailyPosts(10);
    for (const id of [5, 6, 7, 8])
      embeds[id] = embed(id, '2026-09-06T12:00:00Z', true);
    const preview = hiddenChannel(embeds);
    const connector = new TelegramConnector({} as any, preview as any, 0);

    const posts = await connector.getPosts(
      account,
      new Date('2026-09-01T00:00:00Z'),
    );

    expect(ids(posts)).toEqual([2, 3, 4, 5, 9, 10]);
  });

  // Seen on @ehinaceya: a 10-part album took ids 820 and 822–830, while 821 was a
  // separate post sent in the same second. Collapsing only adjacent parts counted
  // that album twice, as 822 and 820.
  it('counts an album once even when another post sits between its parts', async () => {
    const embeds = dailyPosts(10);
    const sameSecond = '2026-09-06T12:00:00Z';
    for (const id of [5, 7, 8]) embeds[id] = embed(id, sameSecond, true);
    embeds[6] = embed(6, sameSecond);
    const preview = hiddenChannel(embeds);
    const connector = new TelegramConnector({} as any, preview as any, 0);

    const posts = await connector.getPosts(
      account,
      new Date('2026-09-01T00:00:00Z'),
    );

    expect(ids(posts)).toEqual([2, 3, 4, 5, 6, 9, 10]);
  });

  it('does not touch embed pages when the preview page works', async () => {
    const preview = {
      fetchPage: jest
        .fn()
        .mockResolvedValue(page([101, 102, 103], '2026-09-03T10:00:00+00:00')),
      fetchEmbed: jest.fn(),
    };
    const connector = new TelegramConnector({} as any, preview as any, 0);

    await connector.getPosts(account, new Date('2026-09-01'));

    expect(preview.fetchEmbed).not.toHaveBeenCalled();
  });

  // One request per post: a busy channel over a long window could otherwise make
  // a single sync fire thousands of requests at t.me.
  it('stops after a bounded number of requests, keeping what it read and warning', async () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const preview = hiddenChannel(dailyPosts(2000));
    const connector = new TelegramConnector({} as any, preview as any, 0);

    const posts = await connector.getPosts(
      account,
      new Date('2020-01-01T00:00:00Z'),
    );

    expect(preview.fetchEmbed.mock.calls.length).toBeLessThanOrEqual(300);
    expect(posts.length).toBeGreaterThan(0);
    expect(ids(posts)).toContain(2000);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('@testchannel'),
    );
    warnSpy.mockRestore();
  });
});

describe('TelegramConnector.getPosts', () => {
  const account = { externalId: '@testchannel' } as any;

  it('returns the posts on the first page', async () => {
    const preview = {
      fetchPage: jest
        .fn()
        .mockResolvedValue(page([101, 102, 103], '2026-09-03T10:00:00+00:00')),
    };
    const connector = new TelegramConnector({} as any, preview as any);

    const posts = await connector.getPosts(account, new Date('2026-09-01'));

    expect(posts.map((p) => p.externalPostId)).toEqual(['101', '102', '103']);
    expect(posts[0].type).toBe(PostType.POST);
    expect(posts[0].views).toBe(100);
    expect(posts[0].likes).toBe(0);
  });

  it('walks back through older pages using the oldest post seen', async () => {
    const preview = {
      fetchPage: jest
        .fn()
        .mockResolvedValueOnce(page([102, 103], '2026-09-03T10:00:00+00:00'))
        .mockResolvedValueOnce(page([100, 101], '2026-08-01T10:00:00+00:00')),
    };
    const connector = new TelegramConnector({} as any, preview as any);

    const posts = await connector.getPosts(account, new Date('2026-08-15'));

    expect(preview.fetchPage).toHaveBeenNthCalledWith(
      1,
      '@testchannel',
      undefined,
    );
    expect(preview.fetchPage).toHaveBeenNthCalledWith(2, '@testchannel', '102');
    expect(posts).toHaveLength(4);
  });

  it('stops once a page is older than the window, instead of walking the whole channel', async () => {
    const preview = {
      fetchPage: jest
        .fn()
        .mockResolvedValue(page([49, 50], '2020-01-01T10:00:00+00:00')),
    };
    const connector = new TelegramConnector({} as any, preview as any);

    await connector.getPosts(account, new Date('2026-08-15'));

    expect(preview.fetchPage).toHaveBeenCalledTimes(1);
  });

  it('gives up quietly at the page cap so one channel cannot loop forever', async () => {
    let id = 10_000;
    const preview = {
      fetchPage: jest.fn().mockImplementation(() => {
        id -= 2;
        return Promise.resolve(page([id, id + 1], '2026-09-03T10:00:00+00:00'));
      }),
    };
    const connector = new TelegramConnector({} as any, preview as any);

    await connector.getPosts(account, new Date('2026-01-01'));

    expect(preview.fetchPage).toHaveBeenCalledTimes(25);
  }, 10_000); // 24 real inter-page delays at PAGE_DELAY_MS=300 exceed Jest's 5s default

  it('treats a PreviewUnavailableError on a later page as the end of history, not a failure', async () => {
    const preview = {
      fetchPage: jest
        .fn()
        .mockResolvedValueOnce(
          page([101, 102, 103], '2026-09-03T10:00:00+00:00'),
        )
        .mockRejectedValueOnce(
          new PreviewUnavailableError('no posts before 101'),
        ),
    };
    const connector = new TelegramConnector({} as any, preview as any);

    const posts = await connector.getPosts(account, new Date('2026-01-01'));

    expect(posts.map((p) => p.externalPostId)).toEqual(['101', '102', '103']);
    expect(preview.fetchPage).toHaveBeenCalledTimes(2);
  });

  it('still rejects when the first page is unavailable and no post has an embed page either', async () => {
    const preview = hiddenChannel({});
    const connector = new TelegramConnector({} as any, preview as any, 0);

    await expect(
      connector.getPosts(account, new Date('2026-01-01')),
    ).rejects.toThrow(PreviewUnavailableError);
  });

  it('warns when the page cap is hit before the walk reaches sinceDate, naming the channel', async () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    let id = 10_000;
    const preview = {
      fetchPage: jest.fn().mockImplementation(() => {
        id -= 2;
        return Promise.resolve(page([id, id + 1], '2026-09-03T10:00:00+00:00'));
      }),
    };
    const connector = new TelegramConnector({} as any, preview as any);

    await connector.getPosts(account, new Date('2026-01-01'));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('@testchannel'),
    );
    warnSpy.mockRestore();
  }, 10_000);

  it('does not warn when the walk ends because it reached the date boundary, not the page cap', async () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const preview = {
      fetchPage: jest
        .fn()
        .mockResolvedValue(page([49, 50], '2020-01-01T10:00:00+00:00')),
    };
    const connector = new TelegramConnector({} as any, preview as any);

    await connector.getPosts(account, new Date('2026-08-15'));

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('still rejects when a later page throws a generic (non-preview) error', async () => {
    const preview = {
      fetchPage: jest
        .fn()
        .mockResolvedValueOnce(
          page([101, 102, 103], '2026-09-03T10:00:00+00:00'),
        )
        .mockRejectedValueOnce(new Error('network')),
    };
    const connector = new TelegramConnector({} as any, preview as any);

    await expect(
      connector.getPosts(account, new Date('2026-01-01')),
    ).rejects.toThrow('network');
  });
});
