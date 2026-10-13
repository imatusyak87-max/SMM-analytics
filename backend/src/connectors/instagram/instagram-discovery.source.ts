import { Account } from '../../db/entities/account.entity';
import { AccountInfo, AccountStats, ConnectorPost, HistoryPage } from '../connector.interface';
import { HistoryPauseError, isNetworkError, networkPause } from '../history-pause.error';
import { InstagramMedia } from './instagram-api.client';
import { DiscoveryPage, InstagramDiscoveryClient } from './instagram-discovery.client';
import { InstagramDiscoveryConnectionService } from './instagram-discovery-connection.service';
import { InstagramDiscoveryUnavailableError, InstagramProfileNotFoundError } from './instagram-discovery.errors';
import { isInstagramAuthError, isInstagramProfileNotFoundError, isInstagramRateLimitError, translateInstagramError } from './instagram-error';
import { mapInstagramPost, NO_INSIGHTS } from './instagram-post-mapper';
import { instagramRateLimitPause } from './instagram.connector';

function toPost(media: InstagramMedia): ConnectorPost {
  return mapInstagramPost(media, { ...NO_INSIGHTS, views: media.viewCount });
}

/**
 * Reads someone else's public Business/Creator account via Business Discovery,
 * made as the user's own Instagram account through the shared Facebook connection.
 * Likes, comments and Reels' public view count — no insights exist for accounts we do not own.
 */
export class InstagramDiscoverySource {
  constructor(
    private client: InstagramDiscoveryClient,
    private connection: InstagramDiscoveryConnectionService,
  ) {}

  async getAccountInfo(account: Account): Promise<AccountInfo> {
    const { profile } = await this.lookup(account, null);
    return {
      name: profile.name ?? profile.username,
      avatarUrl: profile.profilePictureUrl,
      description: profile.biography,
      platformUserId: profile.id,
    };
  }

  async getAccountStats(account: Account): Promise<AccountStats> {
    const { profile } = await this.lookup(account, null);
    return { followersCount: profile.followersCount, followingCount: profile.followsCount, postsCount: profile.mediaCount };
  }

  async getPosts(account: Account, sinceDate: Date): Promise<ConnectorPost[]> {
    const collected: ConnectorPost[] = [];
    let cursor: string | null = null;
    // Newest first, like /me/media: stop at the first post older than sinceDate.
    for (;;) {
      const page: DiscoveryPage = await this.lookup(account, cursor);
      for (const media of page.media) {
        if (new Date(media.timestamp) < sinceDate) return collected;
        collected.push(toPost(media));
      }
      if (!page.nextCursor) return collected;
      cursor = page.nextCursor;
    }
  }

  async loadHistoryPage(account: Account, cursor: string | null): Promise<HistoryPage> {
    const page = await this.lookup(account, cursor);
    return { posts: page.media.map(toPost), nextCursor: page.nextCursor };
  }

  private async lookup(account: Account, after: string | null): Promise<DiscoveryPage> {
    const { igUserId, token } = await this.connection.getCredentials();
    const username = account.externalId.replace(/^@/, '');
    try {
      return await this.client.discover(token, igUserId, username, after);
    } catch (error) {
      if (error instanceof HistoryPauseError) throw error;
      if (isInstagramProfileNotFoundError(error)) throw new InstagramProfileNotFoundError();
      if (isInstagramAuthError(error)) {
        await this.connection.markNeedsReconnect();
        throw new InstagramDiscoveryUnavailableError('reconnect');
      }
      if (isInstagramRateLimitError(error)) throw instagramRateLimitPause();
      if (isNetworkError(error)) throw networkPause();
      throw translateInstagramError(error);
    }
  }
}
