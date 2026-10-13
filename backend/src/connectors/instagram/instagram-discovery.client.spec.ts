import axios from 'axios';
import { InstagramDiscoveryClient } from './instagram-discovery.client';

jest.mock('axios');
const mockedGet = axios.get as jest.MockedFunction<typeof axios.get>;

const REDIRECT = 'https://fdagency.duckdns.org/api/instagram/discovery/callback';
const client = () => new InstagramDiscoveryClient('fb-app', 'fb-secret', REDIRECT);

const rawMedia = {
  id: 'm1',
  caption: 'Hi',
  media_type: 'VIDEO',
  media_product_type: 'REELS',
  thumbnail_url: 'https://cdn/t.jpg',
  permalink: 'https://www.instagram.com/reel/abc/',
  timestamp: '2026-09-10T10:00:00+0000',
  like_count: 12,
  comments_count: 3,
};

describe('InstagramDiscoveryClient', () => {
  beforeEach(() => jest.clearAllMocks());

  it('exchanges the code for a user token', async () => {
    mockedGet.mockResolvedValue({ data: { access_token: 'short' } } as any);

    expect(await client().exchangeCodeForToken('the-code')).toBe('short');
    expect(mockedGet).toHaveBeenCalledWith('https://graph.facebook.com/v23.0/oauth/access_token', {
      params: { client_id: 'fb-app', client_secret: 'fb-secret', redirect_uri: REDIRECT, code: 'the-code' },
      timeout: 15_000,
    });
  });

  it('swaps a short-lived token for a long-lived one', async () => {
    mockedGet.mockResolvedValue({ data: { access_token: 'long', expires_in: 5_184_000 } } as any);

    expect(await client().exchangeForLongLivedToken('short')).toEqual({ accessToken: 'long', expiresInSeconds: 5_184_000 });
    expect(mockedGet.mock.calls[0][1]).toEqual({
      params: { grant_type: 'fb_exchange_token', client_id: 'fb-app', client_secret: 'fb-secret', fb_exchange_token: 'short' },
      timeout: 15_000,
    });
  });

  it('reports a token without expires_in as non-expiring', async () => {
    mockedGet.mockResolvedValue({ data: { access_token: 'long' } } as any);

    expect((await client().exchangeForLongLivedToken('short')).expiresInSeconds).toBeNull();
  });

  it('finds the first Page that has an Instagram business account', async () => {
    mockedGet.mockResolvedValue({
      data: { data: [{ id: 'page-1' }, { id: 'page-2', instagram_business_account: { id: '1784', username: 'fdagency' } }] },
    } as any);

    expect(await client().findLinkedInstagramAccount('tok')).toEqual({ igUserId: '1784', igUsername: 'fdagency' });
    expect(mockedGet).toHaveBeenCalledWith('https://graph.facebook.com/v23.0/me/accounts', {
      params: { fields: 'instagram_business_account{id,username}', access_token: 'tok' },
      timeout: 15_000,
    });
  });

  it('returns null when no Page has an Instagram account linked', async () => {
    mockedGet.mockResolvedValue({ data: { data: [{ id: 'page-1' }] } } as any);

    expect(await client().findLinkedInstagramAccount('tok')).toBeNull();
  });

  it('looks a competitor up through business_discovery and maps profile and media', async () => {
    mockedGet.mockResolvedValue({
      data: {
        business_discovery: {
          id: '9001',
          username: 'brand',
          name: 'Brand',
          biography: 'Bio',
          profile_picture_url: 'https://cdn/p.jpg',
          followers_count: 5000,
          follows_count: 10,
          media_count: 300,
          media: { data: [rawMedia], paging: { cursors: { after: 'CUR' } } },
        },
      },
    } as any);

    const page = await client().discover('tok', '1784', 'brand', null);

    expect(page.profile).toEqual({
      id: '9001', username: 'brand', name: 'Brand', biography: 'Bio', profilePictureUrl: 'https://cdn/p.jpg',
      followersCount: 5000, followsCount: 10, mediaCount: 300,
    });
    expect(page.media[0]).toMatchObject({ id: 'm1', mediaProductType: 'REELS', likeCount: 12, commentsCount: 3, mediaUrl: null });
    expect(page.nextCursor).toBe('CUR');
    const [url, config] = mockedGet.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v23.0/1784');
    expect((config as any).params.access_token).toBe('tok');
    expect((config as any).params.fields).toMatch(/^business_discovery\.username\(brand\)\{.*followers_count.*,media\.limit\(50\)\{.*like_count.*\}\}$/);
  });

  it('asks for view_count and maps it, leaving posts without it at null', async () => {
    mockedGet.mockResolvedValue({
      data: {
        business_discovery: {
          id: '9001',
          username: 'brand',
          media: { data: [{ ...rawMedia, view_count: 4334 }, { ...rawMedia, id: 'm2', media_product_type: 'FEED' }] },
        },
      },
    } as any);

    const page = await client().discover('tok', '1784', 'brand', null);

    expect(page.media.map((m) => m.viewCount)).toEqual([4334, null]);
    expect((mockedGet.mock.calls[0][1] as any).params.fields).toMatch(/media\.limit\(50\)\{[^}]*,view_count[,}]/);
  });

  it('passes the cursor to the media edge', async () => {
    mockedGet.mockResolvedValue({ data: { business_discovery: { id: '9001', username: 'brand', media: { data: [] } } } } as any);

    await client().discover('tok', '1784', 'brand', 'CUR');

    expect((mockedGet.mock.calls[0][1] as any).params.fields).toContain('media.after(CUR).limit(50){');
  });

  it('ends the walk on an empty page even if a cursor is present', async () => {
    mockedGet.mockResolvedValue({
      data: { business_discovery: { id: '9001', username: 'brand', media: { data: [], paging: { cursors: { after: 'CUR' } } } } },
    } as any);

    expect((await client().discover('tok', '1784', 'brand', 'CUR')).nextCursor).toBeNull();
  });
});
