import { Logger } from '@nestjs/common';
import { TelegramConnector } from './telegram.connector';
import { AccountPlatform, AccountType } from '../../db/entities/account.entity';
import { PostType } from '../../db/entities/post.entity';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PreviewUnavailableError, parsePreviewPage } from './telegram-preview.parser';
import { HistoryPauseError } from '../history-pause.error';
import { HistoryPauseReason } from '../../db/entities/history-load.entity';

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
        .mockResolvedValue({ type: 'channel', title: 'Test Channel', photoUrl: 'file123', description: 'About the channel' }),
      getChatMemberCount: jest.fn(),
    } as any;
    const connector = new TelegramConnector(client, {} as any);

    const info = await connector.getAccountInfo(account);

    expect(info.name).toBe('Test Channel');
    expect(info.avatarUrl).toBe('file123');
    expect(info.description).toBe('About the channel');
    expect(info.isChannel).toBe(true);
  });

  it('getAccountInfo reports a group as not a channel', async () => {
    // A group's public page says "44 members, 2 online" — the shape of a real
    // spam pick (@Dr_Vyalov) that a channel check alone would have caught.
    const client = {
      getChat: jest.fn().mockResolvedValue({ type: 'supergroup', title: 'Доктор', photoUrl: null, description: null }),
    } as any;
    const connector = new TelegramConnector(client, {} as any);

    expect((await connector.getAccountInfo(account)).isChannel).toBe(false);
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

describe('TelegramConnector.getLatestPostAt', () => {
  const account = { externalId: '@testchannel' } as any;
  const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf-8');

  it('returns the newest post date from the public preview page', async () => {
    const html = fixture('preview-page.html');
    const preview = { fetchPage: jest.fn().mockResolvedValue(html) } as any;
    const connector = new TelegramConnector({} as any, preview);

    const newest = Math.max(...parsePreviewPage(html, 'testchannel').map((p) => p.publishedAt.getTime()));

    expect(await connector.getLatestPostAt(account)).toEqual(new Date(newest));
    expect(preview.fetchPage).toHaveBeenCalledWith('@testchannel');
  });

  it('returns null when the channel hides its web preview', async () => {
    // t.me/s/ redirects to the generic channel page, which carries no post list at all.
    const preview = { fetchPage: jest.fn().mockResolvedValue(fixture('preview-unavailable.html')) } as any;
    const connector = new TelegramConnector({} as any, preview);

    expect(await connector.getLatestPostAt(account)).toBeNull();
  });

  it("returns 'none' for a channel whose post list is shown but empty", async () => {
    const empty = `<html><body>
      <div class="tgme_channel_info"><div class="tgme_channel_info_header_title">Пустой канал</div></div>
      <section class="tgme_channel_history js-message_history"></section>
    </body></html>`;
    const preview = { fetchPage: jest.fn().mockResolvedValue(empty) } as any;
    const connector = new TelegramConnector({} as any, preview);

    expect(await connector.getLatestPostAt(account)).toBe('none');
  });

  it('lets network errors through so the caller can tell them from a hidden preview', async () => {
    const preview = { fetchPage: jest.fn().mockRejectedValue(new Error('ETIMEDOUT')) } as any;
    const connector = new TelegramConnector({} as any, preview);

    await expect(connector.getLatestPostAt(account)).rejects.toThrow('ETIMEDOUT');
  });
});

describe('TelegramConnector.loadHistoryPage', () => {
  const account = { externalId: '@testchannel' } as any;

  it('reads the newest preview page first and points the cursor at its oldest post', async () => {
    const preview = { fetchPage: jest.fn().mockResolvedValue(page([5, 6, 7], '2024-03-12T10:00:00Z')), fetchEmbed: jest.fn() };
    const connector = new TelegramConnector({} as any, preview as any, 0);

    const result = await connector.loadHistoryPage(account, null);

    expect(preview.fetchPage).toHaveBeenCalledWith('@testchannel', undefined);
    expect(ids(result.posts)).toEqual([5, 6, 7]);
    expect(result.nextCursor).toBe('p:5');
  });

  it('continues the preview walk from the cursor, with no page cap', async () => {
    const preview = { fetchPage: jest.fn().mockResolvedValue(page([2, 3, 4], '2021-01-01T10:00:00Z')), fetchEmbed: jest.fn() };
    const connector = new TelegramConnector({} as any, preview as any, 0);

    const result = await connector.loadHistoryPage(account, 'p:5');

    expect(preview.fetchPage).toHaveBeenCalledWith('@testchannel', '5');
    expect(result.nextCursor).toBe('p:2');
  });

  it('ends the preview walk when the page before the cursor has no posts', async () => {
    const preview = { fetchPage: jest.fn().mockRejectedValue(new PreviewUnavailableError('past the start')), fetchEmbed: jest.fn() };
    const connector = new TelegramConnector({} as any, preview as any, 0);

    expect(await connector.loadHistoryPage(account, 'p:1')).toEqual({ posts: [], nextCursor: null });
  });

  it('ends the preview walk when Telegram hands back the same page again', async () => {
    const preview = { fetchPage: jest.fn().mockResolvedValue(page([1, 2], '2020-01-01T10:00:00Z')), fetchEmbed: jest.fn() };
    const connector = new TelegramConnector({} as any, preview as any, 0);

    expect((await connector.loadHistoryPage(account, 'p:1')).nextCursor).toBeNull();
  });

  it('switches to the embed walk for a channel with its preview disabled, starting at the newest post', async () => {
    const preview = hiddenChannel(dailyPosts(120));
    const connector = new TelegramConnector({} as any, preview as any, 0);

    const result = await connector.loadHistoryPage(account, null);

    // 50 ids per call, newest first.
    expect(ids(result.posts)).toEqual(Array.from({ length: 50 }, (_, i) => 71 + i));
    expect(result.nextCursor).toBe('e:70');
  });

  it('walks the embed pages down to post 1, skipping deleted posts without stopping', async () => {
    const preview = hiddenChannel(dailyPosts(30, [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]));
    const connector = new TelegramConnector({} as any, preview as any, 0);

    const result = await connector.loadHistoryPage(account, 'e:20');

    expect(ids(result.posts)).toEqual([1, 2, 3, 16, 17, 18, 19, 20]);
    expect(result.nextCursor).toBeNull();
  });

  it('does not end an embed chunk inside an album', async () => {
    // Ids 52..4 are ordinary posts (49 reads); ids 3, 2, 1 are one album. The
    // 50-read budget runs out on id 3, inside the album, so the walk must keep
    // reading 2 and 1.
    const embeds: Record<number, string> = {};
    for (let id = 4; id <= 52; id++) embeds[id] = embed(id, new Date(Date.UTC(2023, 0, id)).toISOString());
    const albumTime = '2022-06-01T10:00:00Z';
    embeds[3] = embed(3, albumTime, true);
    embeds[2] = embed(2, albumTime, true);
    embeds[1] = embed(1, albumTime, true);
    const preview = hiddenChannel(embeds);
    const connector = new TelegramConnector({} as any, preview as any, 0);

    const result = await connector.loadHistoryPage(account, 'e:52');

    const albumEntries = result.posts.filter((p) => p.publishedAt.toISOString() === new Date(albumTime).toISOString());
    expect(albumEntries.map((p) => p.externalPostId)).toEqual(['1']);
    expect(result.nextCursor).toBeNull();
  });

  it('leaves the post after a finished album for the next chunk', async () => {
    const embeds: Record<number, string> = {};
    for (let id = 3; id <= 51; id++) embeds[id] = embed(id, new Date(Date.UTC(2023, 0, id)).toISOString());
    const albumTime = '2022-06-01T10:00:00Z';
    embeds[3] = embed(3, albumTime, true);
    embeds[2] = embed(2, albumTime, true);
    embeds[1] = embed(1, '2022-05-01T10:00:00Z');
    const preview = hiddenChannel(embeds);
    const connector = new TelegramConnector({} as any, preview as any, 0);

    const result = await connector.loadHistoryPage(account, 'e:51');

    expect(result.posts.some((p) => p.externalPostId === '1')).toBe(false);
    expect(result.posts.filter((p) => p.publishedAt.toISOString() === new Date(albumTime).toISOString()).map((p) => p.externalPostId)).toEqual(['2']);
    expect(result.nextCursor).toBe('e:1');
  });

  it('pauses for five minutes when Telegram answers 429', async () => {
    const preview = { fetchPage: jest.fn().mockRejectedValue({ response: { status: 429 }, message: 'Request failed with status code 429' }), fetchEmbed: jest.fn() };
    const connector = new TelegramConnector({} as any, preview as any, 0);

    const error = await connector.loadHistoryPage(account, 'p:9').catch((e) => e);

    expect(error).toBeInstanceOf(HistoryPauseError);
    expect(error.reason).toBe(HistoryPauseReason.TELEGRAM_RATE_LIMIT);
    expect(error.retryAfterMs).toBe(5 * 60_000);
    expect(error.message).toBe('Telegram ограничил запросы, продолжим через 5 минут');
  });

  it('pauses on a network timeout', async () => {
    const preview = { fetchPage: jest.fn(), fetchEmbed: jest.fn().mockRejectedValue({ code: 'ECONNABORTED', message: 'timeout' }) };
    const connector = new TelegramConnector({} as any, preview as any, 0);

    const error = await connector.loadHistoryPage(account, 'e:5').catch((e) => e);

    expect(error).toBeInstanceOf(HistoryPauseError);
    expect(error.reason).toBe(HistoryPauseReason.NETWORK);
  });
});
