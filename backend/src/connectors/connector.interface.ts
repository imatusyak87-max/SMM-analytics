import { Account, AccountPlatform } from '../db/entities/account.entity';
import { PostType } from '../db/entities/post.entity';

export interface AccountInfo {
  name: string;
  avatarUrl: string | null;
}

export interface AccountStats {
  followersCount: number;
  followingCount: number | null;
  postsCount: number;
}

export interface ConnectorPost {
  externalPostId: string;
  type: PostType;
  publishedAt: Date;
  permalink: string | null;
  thumbnailUrl: string | null;
  caption: string | null;
  likes: number;
  comments: number;
  shares: number;
  views: number | null;
  reach: number | null;
}

/**
 * getPosts may return [] for push-based platforms (e.g. Telegram Bot API,
 * which delivers posts via webhook, not on-demand fetch) — callers must
 * not treat an empty array as a sync failure.
 */
export interface SocialConnector {
  platform: AccountPlatform;
  getAccountInfo(account: Account): Promise<AccountInfo>;
  getAccountStats(account: Account): Promise<AccountStats>;
  getPosts(account: Account, sinceDate: Date): Promise<ConnectorPost[]>;
}
