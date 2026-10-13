import axios from 'axios';
import { InstagramMedia, MEDIA_FIELDS, mapRawMedia } from './instagram-api.client';

const GRAPH_BASE = 'https://graph.facebook.com/v23.0';
const REQUEST_TIMEOUT_MS = 15_000;
// Media per business_discovery call. The call counts once against the rate
// limit regardless of size, so fewer, larger pages are cheaper.
const PAGE_SIZE = 50;

// view_count is Business Discovery's public play count: present on Reels,
// silently omitted for feed posts and carousels (checked live 2026-10-12).
const DISCOVERY_MEDIA_FIELDS = `${MEDIA_FIELDS},view_count`;

const PROFILE_FIELDS = 'id,username,name,biography,profile_picture_url,followers_count,follows_count,media_count';

export interface DiscoveredProfile {
  id: string;
  username: string;
  name: string | null;
  biography: string | null;
  profilePictureUrl: string | null;
  followersCount: number;
  followsCount: number;
  mediaCount: number;
}

export interface DiscoveryPage {
  profile: DiscoveredProfile;
  media: InstagramMedia[];
  nextCursor: string | null;
}

export interface LinkedInstagramAccount {
  igUserId: string;
  igUsername: string;
}

/**
 * Calls graph.facebook.com with a Facebook user token — the "Instagram API
 * with Facebook Login", the only flavour that offers Business Discovery.
 * Errors are thrown raw; callers translate them.
 */
export class InstagramDiscoveryClient {
  constructor(
    private appId: string,
    private appSecret: string,
    private redirectUri: string,
  ) {}

  async exchangeCodeForToken(code: string): Promise<string> {
    const { data } = await axios.get(`${GRAPH_BASE}/oauth/access_token`, {
      params: { client_id: this.appId, client_secret: this.appSecret, redirect_uri: this.redirectUri, code },
      timeout: REQUEST_TIMEOUT_MS,
    });
    if (!data?.access_token) throw new Error('Facebook returned an unexpected token response');
    return data.access_token;
  }

  async exchangeForLongLivedToken(token: string): Promise<{ accessToken: string; expiresInSeconds: number | null }> {
    const { data } = await axios.get(`${GRAPH_BASE}/oauth/access_token`, {
      params: { grant_type: 'fb_exchange_token', client_id: this.appId, client_secret: this.appSecret, fb_exchange_token: token },
      timeout: REQUEST_TIMEOUT_MS,
    });
    return { accessToken: data.access_token, expiresInSeconds: typeof data.expires_in === 'number' ? data.expires_in : null };
  }

  async findLinkedInstagramAccount(token: string): Promise<LinkedInstagramAccount | null> {
    const { data } = await axios.get(`${GRAPH_BASE}/me/accounts`, {
      params: { fields: 'instagram_business_account{id,username}', access_token: token },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const page = (data.data ?? []).find((p: any) => p.instagram_business_account?.id);
    if (!page) return null;
    return { igUserId: String(page.instagram_business_account.id), igUsername: page.instagram_business_account.username };
  }

  async discover(token: string, igUserId: string, username: string, after: string | null): Promise<DiscoveryPage> {
    const mediaEdge = `media${after ? `.after(${after})` : ''}.limit(${PAGE_SIZE}){${DISCOVERY_MEDIA_FIELDS}}`;
    const { data } = await axios.get(`${GRAPH_BASE}/${igUserId}`, {
      params: { fields: `business_discovery.username(${username}){${PROFILE_FIELDS},${mediaEdge}}`, access_token: token },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const found = data?.business_discovery;
    if (!found) throw new Error('Facebook returned no business_discovery data');

    const media: InstagramMedia[] = (found.media?.data ?? []).map(mapRawMedia);
    // Unlike /me/media, this nested edge is not documented to carry `paging.next`;
    // an empty page is the reliable end marker, at the cost of one extra call.
    const nextCursor = media.length > 0 ? (found.media?.paging?.cursors?.after ?? null) : null;

    return {
      profile: {
        id: String(found.id),
        username: found.username,
        name: found.name ?? null,
        biography: found.biography ?? null,
        profilePictureUrl: found.profile_picture_url ?? null,
        followersCount: found.followers_count ?? 0,
        followsCount: found.follows_count ?? 0,
        mediaCount: found.media_count ?? 0,
      },
      media,
      nextCursor,
    };
  }
}
