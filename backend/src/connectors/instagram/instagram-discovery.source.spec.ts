import { AccountPlatform, AccountType } from '../../db/entities/account.entity';
import { HistoryPauseError } from '../history-pause.error';
import { InstagramDiscoverySource } from './instagram-discovery.source';
import { InstagramDiscoveryUnavailableError, InstagramProfileNotFoundError } from './instagram-discovery.errors';

const competitor = { platform: AccountPlatform.INSTAGRAM, externalId: '@brand', type: AccountType.PUBLIC_NO_ACCESS } as any;

const profile = {
  id: '9001', username: 'brand', name: null, biography: 'Bio', profilePictureUrl: 'https://cdn/p.jpg',
  followersCount: 5000, followsCount: 10, mediaCount: 300,
};
const media = (id: string, timestamp: string) => ({
  id, timestamp, caption: null, mediaType: 'IMAGE', mediaProductType: 'FEED', mediaUrl: 'https://cdn/m.jpg',
  thumbnailUrl: null, permalink: null, likeCount: 7, commentsCount: 2, viewCount: null,
});

function setup(discover: jest.Mock) {
  const client = { discover };
  const connection = {
    getCredentials: jest.fn().mockResolvedValue({ igUserId: '1784', token: 'fb-token' }),
    markNeedsReconnect: jest.fn(),
  };
  return { source: new InstagramDiscoverySource(client as any, connection as any), client, connection };
}

describe('InstagramDiscoverySource', () => {
  it('looks the account up by username without the @', async () => {
    const { source, client } = setup(jest.fn().mockResolvedValue({ profile, media: [], nextCursor: null }));

    const info = await source.getAccountInfo(competitor);

    expect(client.discover).toHaveBeenCalledWith('fb-token', '1784', 'brand', null);
    expect(info).toEqual({ name: 'brand', avatarUrl: 'https://cdn/p.jpg', description: 'Bio', platformUserId: '9001' });
  });

  it('maps follower, following and post counts', async () => {
    const { source } = setup(jest.fn().mockResolvedValue({ profile, media: [], nextCursor: null }));

    expect(await source.getAccountStats(competitor)).toEqual({ followersCount: 5000, followingCount: 10, postsCount: 300 });
  });

  it('walks pages until a post older than sinceDate, with no insights', async () => {
    const discover = jest
      .fn()
      .mockResolvedValueOnce({ profile, media: [media('a', '2026-09-20T00:00:00+0000')], nextCursor: 'C1' })
      .mockResolvedValueOnce({ profile, media: [media('b', '2026-09-10T00:00:00+0000'), media('c', '2026-08-01T00:00:00+0000')], nextCursor: 'C2' });
    const { source } = setup(discover);

    const posts = await source.getPosts(competitor, new Date('2026-09-01'));

    expect(posts.map((p) => p.externalPostId)).toEqual(['a', 'b']);
    expect(posts[0]).toMatchObject({ likes: 7, comments: 2, views: null, reach: null, shares: 0 });
    expect(discover).toHaveBeenCalledTimes(2);
    expect(discover).toHaveBeenLastCalledWith('fb-token', '1784', 'brand', 'C1');
  });

  it('carries a Reel’s public view count into the post, on sync and history pages alike', async () => {
    const reel = { ...media('r', '2026-09-20T00:00:00+0000'), mediaProductType: 'REELS', viewCount: 4334 };
    const { source } = setup(jest.fn().mockResolvedValue({ profile, media: [reel], nextCursor: null }));

    const [synced] = await source.getPosts(competitor, new Date('2026-09-01'));
    const [paged] = (await source.loadHistoryPage(competitor, null)).posts;

    expect(synced).toMatchObject({ views: 4334, reach: null, shares: 0 });
    expect(paged).toMatchObject({ views: 4334, reach: null, shares: 0 });
  });

  it('returns one history page with its cursor', async () => {
    const { source } = setup(jest.fn().mockResolvedValue({ profile, media: [media('a', '2026-09-20T00:00:00+0000')], nextCursor: 'C1' }));

    const page = await source.loadHistoryPage(competitor, 'C0');

    expect(page.posts.map((p) => p.externalPostId)).toEqual(['a']);
    expect(page.nextCursor).toBe('C1');
  });

  it('turns "cannot find user" into a not-found error', async () => {
    const { source } = setup(jest.fn().mockRejectedValue({ response: { status: 400, data: { error: { code: 110, error_subcode: 2207013 } } } }));

    await expect(source.getAccountInfo(competitor)).rejects.toBeInstanceOf(InstagramProfileNotFoundError);
  });

  it('flags the Facebook connection, not an account, when the token is rejected', async () => {
    const { source, connection } = setup(jest.fn().mockRejectedValue({ response: { status: 400, data: { error: { type: 'OAuthException', code: 190 } } } }));

    await expect(source.getAccountStats(competitor)).rejects.toMatchObject({ reason: 'reconnect' });
    expect(connection.markNeedsReconnect).toHaveBeenCalled();
  });

  it('pauses on a rate limit', async () => {
    const { source } = setup(jest.fn().mockRejectedValue({ response: { status: 400, data: { error: { code: 4 } } } }));

    await expect(source.loadHistoryPage(competitor, null)).rejects.toBeInstanceOf(HistoryPauseError);
  });

  it('passes on the connection\'s own refusal untouched', async () => {
    const { source, connection, client } = setup(jest.fn());
    connection.getCredentials.mockRejectedValue(new InstagramDiscoveryUnavailableError('not_connected'));

    await expect(source.getAccountInfo(competitor)).rejects.toMatchObject({ reason: 'not_connected' });
    expect(client.discover).not.toHaveBeenCalled();
  });
});
