import { AccountPlatform, Account } from '../../db/entities/account.entity';
import { AccountInfo, AccountStats, ConnectorPost, SocialConnector } from '../connector.interface';
import { TelegramApiClient } from './telegram-api.client';

export class TelegramConnector implements SocialConnector {
  platform = AccountPlatform.TELEGRAM;

  constructor(private client: TelegramApiClient) {}

  async getAccountInfo(account: Account): Promise<AccountInfo> {
    const chat = await this.client.getChat(account.externalId);
    return { name: chat.title, avatarUrl: chat.photoUrl };
  }

  async getAccountStats(account: Account): Promise<AccountStats> {
    const count = await this.client.getChatMemberCount(account.externalId);
    return { followersCount: count, followingCount: null, postsCount: 0 };
  }

  async getPosts(_account: Account, _sinceDate: Date): Promise<ConnectorPost[]> {
    // Telegram Bot API cannot pull post history or views; posts are
    // ingested live via the webhook in Task 10 instead.
    return [];
  }
}
