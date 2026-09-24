import axios from 'axios';
import { Repository } from 'typeorm';
import { Account, AccountPlatform } from '../../db/entities/account.entity';
import { AccountCredential } from '../../db/entities/account-credential.entity';
import { AccountInfo, AccountStats, AvatarImage, ConnectorPost, SocialConnector } from '../connector.interface';
import { InstagramApiClient } from './instagram-api.client';
import { decryptToken } from './instagram-token-crypto';
import { isInstagramAuthError, translateInstagramError } from './instagram-error';
import { mapInstagramPost } from './instagram-post-mapper';

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
          const insights = await this.api.getMediaInsights(token, media.id);
          collected.push(mapInstagramPost(media, insights));
        }
        if (!nextCursor) break;
        after = nextCursor;
      }

      return collected;
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
      if (isInstagramAuthError(error)) {
        await this.credentialsRepo.update({ accountId: account.id }, { needsReconnect: true });
      }
      throw translateInstagramError(error);
    }
  }
}
