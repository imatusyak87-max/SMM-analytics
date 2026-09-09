import { TelegramConnector } from './telegram.connector';
import { AccountPlatform, AccountType } from '../../db/entities/account.entity';
import { PostType } from '../../db/entities/post.entity';

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
    const connector = new TelegramConnector(client, {} as any);

    const stats = await connector.getAccountStats(account);

    expect(stats.followersCount).toBe(1234);
    expect(stats.followingCount).toBeNull();
  });

  it('getAccountInfo maps chat title and photo', async () => {
    const client = {
      getChat: jest.fn().mockResolvedValue({ title: 'Test Channel', photoUrl: 'file123' }),
      getChatMemberCount: jest.fn(),
    } as any;
    const connector = new TelegramConnector(client, {} as any);

    const info = await connector.getAccountInfo(account);

    expect(info.name).toBe('Test Channel');
    expect(info.avatarUrl).toBe('file123');
  });

  it('getAvatar downloads the photo the file reference points at', async () => {
    const client = {
      downloadFile: jest.fn().mockResolvedValue({ data: Buffer.from('bytes'), contentType: 'image/jpeg' }),
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

describe('TelegramConnector.getPosts', () => {
  const account = { externalId: '@testchannel' } as any;

  it('returns the posts on the first page', async () => {
    const preview = { fetchPage: jest.fn().mockResolvedValue(page([101, 102, 103], '2026-09-03T10:00:00+00:00')) };
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

    expect(preview.fetchPage).toHaveBeenNthCalledWith(1, '@testchannel', undefined);
    expect(preview.fetchPage).toHaveBeenNthCalledWith(2, '@testchannel', '102');
    expect(posts).toHaveLength(4);
  });

  it('stops once a page is older than the window, instead of walking the whole channel', async () => {
    const preview = {
      fetchPage: jest.fn().mockResolvedValue(page([49, 50], '2020-01-01T10:00:00+00:00')),
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
});
