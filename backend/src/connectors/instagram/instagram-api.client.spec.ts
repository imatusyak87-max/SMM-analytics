import { Logger } from '@nestjs/common';
import axios from 'axios';
import { InstagramApiClient } from './instagram-api.client';

jest.mock('axios');
const mockedGet = axios.get as jest.MockedFunction<typeof axios.get>;
const mockedPost = axios.post as jest.MockedFunction<typeof axios.post>;

// Matches the module-level REQUEST_TIMEOUT_MS in instagram-api.client.ts — kept as a
// literal (like telegram-preview.client.spec.ts) since the constant isn't exported.
const REQUEST_TIMEOUT_MS = 15_000;

describe('InstagramApiClient', () => {
  beforeEach(() => jest.clearAllMocks());

  it('exchanges an OAuth code for a short-lived token and the ig user id', async () => {
    mockedPost.mockResolvedValue({ data: { access_token: 'short-tok', user_id: '17841400000000000' } } as any);
    const client = new InstagramApiClient('app-id', 'app-secret', 'https://fdagency.duckdns.org/api/instagram/callback');

    const result = await client.exchangeCodeForToken('a-code');

    expect(result).toEqual({ accessToken: 'short-tok', instagramUserId: '17841400000000000' });
    const [url, form, config] = mockedPost.mock.calls[0];
    expect(url).toBe('https://api.instagram.com/oauth/access_token');
    expect((form as URLSearchParams).get('code')).toBe('a-code');
    expect((form as URLSearchParams).get('client_secret')).toBe('app-secret');
    expect(config).toEqual({ timeout: REQUEST_TIMEOUT_MS });
  });

  it.each([
    ['access_token', { user_id: '17841400000000000' }],
    ['user_id', { access_token: 'short-tok' }],
  ])('refuses a code-exchange response with no %s', async (_missing, data) => {
    mockedPost.mockResolvedValue({ data } as any);
    const client = new InstagramApiClient('app-id', 'app-secret', 'https://example.com/callback');

    await expect(client.exchangeCodeForToken('a-code')).rejects.toThrow();
  });

  it('exchanges a short-lived token for a long-lived one', async () => {
    mockedGet.mockResolvedValue({ data: { access_token: 'long-tok', expires_in: 5184000 } } as any);
    const client = new InstagramApiClient('app-id', 'app-secret', 'https://example.com/callback');

    const result = await client.exchangeForLongLivedToken('short-tok');

    expect(result).toEqual({ accessToken: 'long-tok', expiresInSeconds: 5184000 });
    const [url, config] = mockedGet.mock.calls[0];
    // Secret and token go through axios params (URL-encoded), never concatenated into the URL.
    expect(url).toBe('https://graph.instagram.com/v23.0/access_token');
    expect(config).toEqual({
      params: { grant_type: 'ig_exchange_token', client_secret: 'app-secret', access_token: 'short-tok' },
      timeout: REQUEST_TIMEOUT_MS,
    });
  });

  it('refreshes a long-lived token', async () => {
    mockedGet.mockResolvedValue({ data: { access_token: 'refreshed-tok', expires_in: 5184000 } } as any);
    const client = new InstagramApiClient('app-id', 'app-secret', 'https://example.com/callback');

    const result = await client.refreshLongLivedToken('long-tok');

    expect(result).toEqual({ accessToken: 'refreshed-tok', expiresInSeconds: 5184000 });
    const [url, config] = mockedGet.mock.calls[0];
    expect(url).toBe('https://graph.instagram.com/refresh_access_token');
    expect(config).toEqual({
      params: { grant_type: 'ig_refresh_token', access_token: 'long-tok' },
      timeout: REQUEST_TIMEOUT_MS,
    });
  });

  it('fetches the profile and maps snake_case fields', async () => {
    mockedGet.mockResolvedValue({
      data: {
        id: '17841400000000000',
        username: 'agency_client',
        name: 'Client Name',
        account_type: 'BUSINESS',
        followers_count: 4200,
        follows_count: 180,
        media_count: 96,
        profile_picture_url: 'https://scontent.cdninstagram.com/pic.jpg',
        biography: 'Coffee shop in Moscow',
      },
    } as any);
    const client = new InstagramApiClient('app-id', 'app-secret', 'https://example.com/callback');

    const profile = await client.getProfile('a-token');

    expect(profile).toEqual({
      id: '17841400000000000',
      username: 'agency_client',
      name: 'Client Name',
      accountType: 'BUSINESS',
      followersCount: 4200,
      followsCount: 180,
      mediaCount: 96,
      profilePictureUrl: 'https://scontent.cdninstagram.com/pic.jpg',
      biography: 'Coffee shop in Moscow',
    });
  });

  it('fetches a page of media and the next cursor', async () => {
    mockedGet.mockResolvedValue({
      data: {
        data: [
          {
            id: 'media-1',
            caption: 'A post',
            media_type: 'IMAGE',
            media_product_type: 'FEED',
            media_url: 'https://cdn/img.jpg',
            thumbnail_url: null,
            permalink: 'https://instagram.com/p/abc',
            timestamp: '2026-09-01T10:00:00+0000',
            like_count: 40,
            comments_count: 3,
          },
        ],
        paging: { cursors: { after: 'cursor-2' }, next: 'https://graph.instagram.com/...' },
      },
    } as any);
    const client = new InstagramApiClient('app-id', 'app-secret', 'https://example.com/callback');

    const result = await client.getMedia('a-token');

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({
      id: 'media-1',
      caption: 'A post',
      mediaType: 'IMAGE',
      mediaProductType: 'FEED',
      mediaUrl: 'https://cdn/img.jpg',
      thumbnailUrl: null,
      permalink: 'https://instagram.com/p/abc',
      timestamp: '2026-09-01T10:00:00+0000',
      likeCount: 40,
      commentsCount: 3,
    });
    expect(result.nextCursor).toBe('cursor-2');
    const [, config] = mockedGet.mock.calls[0];
    expect(config).toMatchObject({ timeout: REQUEST_TIMEOUT_MS });
  });

  it('returns a null cursor on the last page', async () => {
    mockedGet.mockResolvedValue({ data: { data: [], paging: { cursors: { after: 'x' } } } } as any);
    const client = new InstagramApiClient('app-id', 'app-secret', 'https://example.com/callback');

    const result = await client.getMedia('a-token');

    expect(result.nextCursor).toBeNull();
  });

  it('fetches media insights, tolerating a metric Instagram does not return', async () => {
    mockedGet.mockResolvedValue({
      data: {
        data: [
          { name: 'reach', values: [{ value: 500 }] },
          { name: 'saved', values: [{ value: 12 }] },
          { name: 'views', values: [{ value: 900 }] },
        ],
      },
    } as any);
    const client = new InstagramApiClient('app-id', 'app-secret', 'https://example.com/callback');

    const insights = await client.getMediaInsights('a-token', 'media-1');

    expect(insights).toEqual({ reach: 500, saved: 12, shares: null, views: 900 });
    const [, config] = mockedGet.mock.calls[0];
    expect(config).toMatchObject({ timeout: REQUEST_TIMEOUT_MS, params: { metric: 'reach,saved,shares,views' } });
  });

  it('asks again without views when Instagram rejects that metric for a post, keeping its reach', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    mockedGet
      .mockRejectedValueOnce({ response: { status: 400, data: { error: { type: 'OAuthException', code: 100 } } } })
      .mockResolvedValueOnce({ data: { data: [{ name: 'reach', values: [{ value: 500 }] }] } } as any);
    const client = new InstagramApiClient('app-id', 'app-secret', 'https://example.com/callback');

    const insights = await client.getMediaInsights('a-token', 'media-1');

    expect(insights).toEqual({ reach: 500, saved: null, shares: null, views: null });
    expect(mockedGet.mock.calls[1][1]).toMatchObject({ params: { metric: 'reach,saved,shares' } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('media-1'));
    expect(warn.mock.calls[0][0]).not.toContain('a-token');
    warn.mockRestore();
  });

  it.each([
    ['an expired token', { response: { status: 400, data: { error: { type: 'OAuthException', code: 190 } } } }],
    ['a rate limit', { response: { status: 400, data: { error: { type: 'OAuthException', code: 4 } } } }],
    ['a timeout', { code: 'ECONNABORTED' }],
  ])('does not ask again after %s', async (_name, failure) => {
    mockedGet.mockRejectedValue(failure);
    const client = new InstagramApiClient('app-id', 'app-secret', 'https://example.com/callback');

    await expect(client.getMediaInsights('a-token', 'media-1')).rejects.toBe(failure);
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('lets a failed request propagate untranslated — the caller classifies and translates it', async () => {
    const rawError = {
      response: { status: 400, data: { error: { type: 'OAuthException', code: 190, message: 'Error validating access token' } } },
    };
    mockedGet.mockRejectedValue(rawError);
    const client = new InstagramApiClient('app-id', 'app-secret', 'https://example.com/callback');

    await expect(client.getProfile('bad-token')).rejects.toBe(rawError);
  });
});
