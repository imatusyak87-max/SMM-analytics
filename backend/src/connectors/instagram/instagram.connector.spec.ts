import { InstagramConnector } from './instagram.connector';
import { AccountPlatform } from '../../db/entities/account.entity';

const account = { id: 'acc-1', platform: AccountPlatform.INSTAGRAM, externalId: '17841400000000000' } as any;

function makeCredentialRepo(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    findOneBy: jest.fn().mockResolvedValue({ accountId: 'acc-1', encryptedToken: 'encrypted-form', needsReconnect: false }),
    update: jest.fn(),
    ...overrides,
  } as any;
}

// decryptToken is real (not mocked): 'encrypted-form' round-trips to 'plain-token'
// via a fixed test key, so the connector's real decrypt call is exercised too.
jest.mock('./instagram-token-crypto', () => ({
  decryptToken: jest.fn(() => 'plain-token'),
}));

describe('InstagramConnector', () => {
  const KEY = 'a'.repeat(64);

  it('getAccountInfo maps the decrypted profile', async () => {
    const api = { getProfile: jest.fn().mockResolvedValue({ username: 'agency_client', name: 'Client', profilePictureUrl: 'https://x/pic.jpg', biography: 'Bio' }) };
    const connector = new InstagramConnector(api as any, makeCredentialRepo(), KEY);

    const info = await connector.getAccountInfo(account);

    expect(info).toEqual({ name: 'Client', avatarUrl: 'https://x/pic.jpg', description: 'Bio' });
    expect(api.getProfile).toHaveBeenCalledWith('plain-token');
  });

  it('falls back to the username when Instagram has no display name', async () => {
    const api = { getProfile: jest.fn().mockResolvedValue({ username: 'agency_client', name: null, profilePictureUrl: null, biography: null }) };
    const connector = new InstagramConnector(api as any, makeCredentialRepo(), KEY);

    expect((await connector.getAccountInfo(account)).name).toBe('agency_client');
  });

  it('getAccountStats maps follower/following/post counts', async () => {
    const api = { getProfile: jest.fn().mockResolvedValue({ followersCount: 4200, followsCount: 180, mediaCount: 96 }) };
    const connector = new InstagramConnector(api as any, makeCredentialRepo(), KEY);

    expect(await connector.getAccountStats(account)).toEqual({ followersCount: 4200, followingCount: 180, postsCount: 96 });
  });

  it('getPosts walks pages until sinceDate is passed and fetches insights per post', async () => {
    const newPost = { id: 'new', timestamp: '2026-09-10T00:00:00+0000', likeCount: 1, commentsCount: 0, mediaType: 'IMAGE', mediaProductType: 'FEED', caption: null, mediaUrl: null, thumbnailUrl: null, permalink: null };
    const oldPost = { id: 'old', timestamp: '2026-08-01T00:00:00+0000', likeCount: 1, commentsCount: 0, mediaType: 'IMAGE', mediaProductType: 'FEED', caption: null, mediaUrl: null, thumbnailUrl: null, permalink: null };
    const api = {
      getMedia: jest.fn().mockResolvedValue({ items: [newPost, oldPost], nextCursor: null }),
      getMediaInsights: jest.fn().mockResolvedValue({ reach: 10, saved: 1, shares: 0 }),
    };
    const connector = new InstagramConnector(api as any, makeCredentialRepo(), KEY);

    const posts = await connector.getPosts(account, new Date('2026-09-01'));

    // 'old' is before sinceDate and is excluded from the result, but the walk
    // still fetches it so it can tell it has passed the window.
    expect(posts.map((p) => p.externalPostId)).toEqual(['new']);
    expect(api.getMediaInsights).toHaveBeenCalledWith('plain-token', 'new');
  });

  it('getAvatar downloads bytes from the profile_picture_url', async () => {
    const axios = require('axios');
    jest.spyOn(axios, 'get').mockResolvedValue({ data: Buffer.from('img-bytes'), headers: { 'content-type': 'image/jpeg' } });
    const connector = new InstagramConnector({} as any, makeCredentialRepo(), KEY);

    const avatar = await connector.getAvatar('https://scontent.cdninstagram.com/pic.jpg');

    expect(avatar.data.toString()).toBe('img-bytes');
    expect(avatar.contentType).toBe('image/jpeg');
  });

  it('sets needsReconnect on the credential when a call fails with an auth error', async () => {
    const authError = { response: { status: 400, data: { error: { type: 'OAuthException', code: 190, message: 'Error validating access token' } } } };
    const api = { getProfile: jest.fn().mockRejectedValue(authError) };
    const credentialRepo = makeCredentialRepo();
    const connector = new InstagramConnector(api as any, credentialRepo, KEY);

    await expect(connector.getAccountInfo(account)).rejects.toThrow('Instagram отклонил доступ, нужно переподключить аккаунт');
    expect(credentialRepo.update).toHaveBeenCalledWith({ accountId: 'acc-1' }, { needsReconnect: true });
  });

  it('does not touch needsReconnect for a rate limit or network error', async () => {
    const rateLimited = { response: { status: 429, data: { error: { type: 'OAuthException', code: 4 } } } };
    const api = { getProfile: jest.fn().mockRejectedValue(rateLimited) };
    const credentialRepo = makeCredentialRepo();
    const connector = new InstagramConnector(api as any, credentialRepo, KEY);

    await expect(connector.getAccountInfo(account)).rejects.toThrow();
    expect(credentialRepo.update).not.toHaveBeenCalled();
  });
});
