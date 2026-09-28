import axios from 'axios';
import { Repository } from 'typeorm';
import { Account, AccountPlatform } from '../../db/entities/account.entity';
import { AccountCredential } from '../../db/entities/account-credential.entity';
import { AccountInfo, AccountStats, AvatarImage, ConnectorPost, HistoryPage, PostInsights, SocialConnector } from '../connector.interface';
import { InstagramApiClient, InstagramMediaInsights } from './instagram-api.client';
import { decryptToken } from './instagram-token-crypto';
import { isInstagramAuthError, isInstagramRateLimitError, translateInstagramError } from './instagram-error';
import { HistoryPauseError, isNetworkError, MINUTE_MS, networkPause } from '../history-pause.error';
import { HistoryPauseReason } from '../../db/entities/history-load.entity';
import { mapInstagramPost } from './instagram-post-mapper';

const NO_INSIGHTS: InstagramMediaInsights = { reach: null, saved: null, shares: null };

function instagramRateLimitPause(): HistoryPauseError {
  return new HistoryPauseError(
    HistoryPauseReason.INSTAGRAM_RATE_LIMIT,
    60 * MINUTE_MS,
    'Превышен лимит запросов к Instagram, попробуйте позже',
  );
}

export class InstagramConnector implements SocialConnector {
  platform = AccountPlatform.INSTAGRAM;

  constructor(
    private api: InstagramApiClient,
    private credentialsRepo: Repository<AccountCredential>,
    private encryptionKey: string,
  ) {}

  async getAccountInfo(account: Account): Promise<AccountInfo> {
    const profile = await this.call(account, (token) => this.api.getProfile(token));
    return {
      // Business/Creator accounts are not required to set a display name — the
      // username is always present and is what the owner sees on their own profile.
      name: profile.name ?? profile.username,
      avatarUrl: profile.profilePictureUrl,
      description: profile.biography,
    };
  }

  async getAccountStats(account: Account): Promise<AccountStats> {
    const profile = await this.call(account, (token) => this.api.getProfile(token));
    return { followersCount: profile.followersCount, followingCount: profile.followsCount, postsCount: profile.mediaCount };
  }

  async getPosts(account: Account, sinceDate: Date): Promise<ConnectorPost[]> {
    return this.call(account, async (token) => {
      const collected: ConnectorPost[] = [];
      let after: string | undefined;

      // Instagram's media list is newest-first; stop paging the moment a post
      // older than sinceDate is seen, same walk shape as the Telegram connector.
      paging: for (;;) {
        const { items, nextCursor } = await this.api.getMedia(token, after);
        for (const media of items) {
          if (new Date(media.timestamp) < sinceDate) break paging;
          collected.push(mapInstagramPost(media, await this.insightsOrNull(token, media.id)));
        }
        if (!nextCursor) break;
        after = nextCursor;
      }

      return collected;
    });
  }

  /**
   * One post's insights can fail on its own (e.g. media from before the
   * account became a Business/Creator account) — that must not lose the
   * rest of the sync. Auth errors still propagate so `call` flags reconnect.
   */
  private async insightsOrNull(token: string, mediaId: string): Promise<InstagramMediaInsights> {
    try {
      return await this.api.getMediaInsights(token, mediaId);
    } catch (error) {
      if (isInstagramAuthError(error) || isInstagramRateLimitError(error) || isNetworkError(error)) throw error;
      return { reach: null, saved: null, shares: null };
    }
  }

  async loadHistoryPage(account: Account, cursor: string | null): Promise<HistoryPage> {
    return this.call(account, async (token) => {
      const { items, nextCursor } = await this.api.getMedia(token, cursor ?? undefined);
      // Insights are a separate, paced phase; the page only carries likes/comments.
      return { posts: items.map((media) => mapInstagramPost(media, NO_INSIGHTS)), nextCursor };
    });
  }

  async loadPostInsights(account: Account, externalPostId: string): Promise<PostInsights> {
    return this.call(account, async (token) => {
      try {
        const insights = await this.api.getMediaInsights(token, externalPostId);
        return { reach: insights.reach, shares: insights.shares };
      } catch (error) {
        // Media from before the account became Business/Creator has no insights;
        // that is an answer, not a failure. Everything temporary goes to `call`.
        if (isInstagramAuthError(error) || isInstagramRateLimitError(error) || isNetworkError(error)) throw error;
        return { reach: null, shares: null };
      }
    });
  }

  async getAvatar(fileRef: string): Promise<AvatarImage> {
    // Unlike Telegram's opaque file id, Instagram's profile_picture_url is a
    // real, directly downloadable URL — no extra API call needed to resolve it.
    const response = await axios.get(fileRef, { responseType: 'arraybuffer' });
    return {
      data: Buffer.from(response.data as ArrayBuffer),
      contentType: (response.headers?.['content-type'] as string) ?? 'image/jpeg',
    };
  }

  /**
   * Decrypts the stored token, runs `fn`, and — on an auth-specific failure
   * only — flags the credential for reconnect before rethrowing the
   * translated error. Every public method goes through this so the flag is
   * set consistently regardless of which call actually failed.
   */
  private async call<T>(account: Account, fn: (token: string) => Promise<T>): Promise<T> {
    // A draft account (e.g. from link-based preview) has no id; TypeORM would
    // drop the undefined where-value and hand back some other account's token.
    if (!account.id) throw new Error('Instagram connector needs a saved account; link-based access is not supported');
    const credential = await this.credentialsRepo.findOneBy({ accountId: account.id });
    if (!credential) throw new Error(`No Instagram credential stored for account ${account.id}`);
    const token = decryptToken(credential.encryptedToken, this.encryptionKey);

    try {
      return await fn(token);
    } catch (error) {
      if (error instanceof HistoryPauseError) throw error;
      if (isInstagramAuthError(error)) {
        await this.credentialsRepo.update({ accountId: account.id }, { needsReconnect: true });
        throw translateInstagramError(error);
      }
      if (isInstagramRateLimitError(error)) throw instagramRateLimitPause();
      if (isNetworkError(error)) throw networkPause();
      throw translateInstagramError(error);
    }
  }
}
