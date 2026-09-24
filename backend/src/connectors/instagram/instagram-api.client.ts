import axios from 'axios';

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.instagram.com/${GRAPH_VERSION}`;

export interface InstagramProfile {
  id: string;
  username: string;
  name: string | null;
  accountType: string;
  followersCount: number;
  followsCount: number;
  mediaCount: number;
  profilePictureUrl: string | null;
  biography: string | null;
}

export interface InstagramMedia {
  id: string;
  caption: string | null;
  mediaType: string;
  mediaProductType: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  timestamp: string;
  likeCount: number;
  commentsCount: number;
}

export interface InstagramMediaInsights {
  reach: number | null;
  saved: number | null;
  shares: number | null;
}

const PROFILE_FIELDS =
  'id,username,name,account_type,followers_count,follows_count,media_count,profile_picture_url,biography';
const MEDIA_FIELDS =
  'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';

export class InstagramApiClient {
  constructor(
    private appId: string,
    private appSecret: string,
    private redirectUri: string,
  ) {}

  async exchangeCodeForToken(code: string): Promise<{ accessToken: string; instagramUserId: string }> {
    const form = new URLSearchParams({
      client_id: this.appId,
      client_secret: this.appSecret,
      grant_type: 'authorization_code',
      redirect_uri: this.redirectUri,
      code,
    });
    const { data } = await axios.post('https://api.instagram.com/oauth/access_token', form);
    if (!data?.access_token || data?.user_id === undefined || data?.user_id === null) {
      throw new Error('Instagram returned an unexpected token response');
    }
    return { accessToken: data.access_token, instagramUserId: String(data.user_id) };
  }

  async exchangeForLongLivedToken(shortLivedToken: string): Promise<{ accessToken: string; expiresInSeconds: number }> {
    const { data } = await axios.get(
      `${GRAPH_BASE}/access_token?grant_type=ig_exchange_token&client_secret=${this.appSecret}&access_token=${shortLivedToken}`,
    );
    return { accessToken: data.access_token, expiresInSeconds: data.expires_in };
  }

  async refreshLongLivedToken(longLivedToken: string): Promise<{ accessToken: string; expiresInSeconds: number }> {
    const { data } = await axios.get(
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${longLivedToken}`,
    );
    return { accessToken: data.access_token, expiresInSeconds: data.expires_in };
  }

  async getProfile(accessToken: string): Promise<InstagramProfile> {
    const { data } = await axios.get(`${GRAPH_BASE}/me`, {
      params: { fields: PROFILE_FIELDS, access_token: accessToken },
    });
    return {
      id: data.id,
      username: data.username,
      name: data.name ?? null,
      accountType: data.account_type,
      followersCount: data.followers_count,
      followsCount: data.follows_count,
      mediaCount: data.media_count,
      profilePictureUrl: data.profile_picture_url ?? null,
      biography: data.biography ?? null,
    };
  }

  async getMedia(accessToken: string, after?: string): Promise<{ items: InstagramMedia[]; nextCursor: string | null }> {
    const { data } = await axios.get(`${GRAPH_BASE}/me/media`, {
      params: { fields: MEDIA_FIELDS, access_token: accessToken, ...(after ? { after } : {}) },
    });
    const items: InstagramMedia[] = (data.data ?? []).map((raw: any) => ({
      id: raw.id,
      caption: raw.caption ?? null,
      mediaType: raw.media_type,
      mediaProductType: raw.media_product_type ?? null,
      mediaUrl: raw.media_url ?? null,
      thumbnailUrl: raw.thumbnail_url ?? null,
      permalink: raw.permalink ?? null,
      timestamp: raw.timestamp,
      likeCount: raw.like_count ?? 0,
      commentsCount: raw.comments_count ?? 0,
    }));
    // Instagram includes a cursor even on the last page; `next` (the follow-up
    // URL) is only present when there truly is another page to fetch.
    const nextCursor = data.paging?.next ? (data.paging?.cursors?.after ?? null) : null;
    return { items, nextCursor };
  }

  async getMediaInsights(accessToken: string, mediaId: string): Promise<InstagramMediaInsights> {
    const { data } = await axios.get(`${GRAPH_BASE}/${mediaId}/insights`, {
      params: { metric: 'reach,saved,shares', access_token: accessToken },
    });
    const byName = new Map<string, number>(
      (data.data ?? []).map((metric: any) => [metric.name, metric.values?.[0]?.value ?? null]),
    );
    return {
      reach: byName.get('reach') ?? null,
      saved: byName.get('saved') ?? null,
      shares: byName.get('shares') ?? null,
    };
  }
}
