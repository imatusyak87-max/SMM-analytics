import { AccountPlatform, Account } from '../../db/entities/account.entity';
import { AccountInfo, AccountStats, AvatarImage, ConnectorPost, SocialConnector } from '../connector.interface';
import { TelegramApiClient } from './telegram-api.client';
import { TelegramPreviewClient } from './telegram-preview.client';
import { parsePreviewPage, PreviewUnavailableError } from './telegram-preview.parser';

const MAX_PAGES = 25;
const PAGE_DELAY_MS = 300;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class TelegramConnector implements SocialConnector {
  platform = AccountPlatform.TELEGRAM;

  constructor(
    private client: TelegramApiClient,
    private preview: TelegramPreviewClient,
  ) {}

  async getAccountInfo(account: Account): Promise<AccountInfo> {
    const chat = await this.client.getChat(account.externalId);
    return { name: chat.title, avatarUrl: chat.photoUrl };
  }

  async getAvatar(fileRef: string): Promise<AvatarImage> {
    return this.client.downloadFile(fileRef);
  }

  async getAccountStats(account: Account): Promise<AccountStats> {
    const count = await this.client.getChatMemberCount(account.externalId);
    return { followersCount: count, followingCount: null, postsCount: 0 };
  }

  /**
   * The Bot API cannot read post history or view counts at all, so posts come from
   * the public preview page instead. Pages are walked newest-first, each request
   * asking for messages older than the oldest one seen so far.
   */
  async getPosts(account: Account, sinceDate: Date): Promise<ConnectorPost[]> {
    const channel = account.externalId;
    const collected: ConnectorPost[] = [];
    const seenIds = new Set<string>();
    let before: string | undefined;

    for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber++) {
      if (pageNumber > 0) await delay(PAGE_DELAY_MS);

      let parsed;
      try {
        const html = await this.preview.fetchPage(channel, before);
        parsed = parsePreviewPage(html, channel.replace(/^@/, ''));
      } catch (err) {
        // The first page throwing PreviewUnavailableError means the channel's preview
        // is unreadable altogether (disabled, or Telegram changed its markup) — that
        // must still fail loudly so the sync job is marked failed and BullMQ retries.
        // The SAME error on a later page just means we've walked past the start of
        // the channel's history, which is a normal way for the walk to end, not a
        // failure — stop and return what was already collected. Any other error
        // (network, timeout, ...) always propagates, on any page.
        if (pageNumber > 0 && err instanceof PreviewUnavailableError) break;
        throw err;
      }

      // The last page of a channel's history can be requested again with the same
      // cursor (or, in tests, a mock that keeps handing back the same fixture) —
      // skip posts already collected so the walk stays idempotent either way.
      for (const post of parsed) {
        if (seenIds.has(post.externalPostId)) continue;
        seenIds.add(post.externalPostId);
        collected.push({
          externalPostId: post.externalPostId,
          type: post.type,
          publishedAt: post.publishedAt,
          permalink: post.permalink,
          thumbnailUrl: post.thumbnailUrl,
          caption: post.caption,
          likes: post.reactions,
          comments: 0,
          shares: 0,
          views: post.views,
          reach: null,
        });
      }

      const oldest = parsed.reduce((a, b) => (a.publishedAt <= b.publishedAt ? a : b));
      if (oldest.publishedAt < sinceDate) break;

      // The preview renders oldest-first, so the next page is requested with the
      // OLDEST id on this one. Using the last element would ask for posts older
      // than the newest one here, returning the same page forever.
      const nextBefore = oldest.externalPostId;
      if (nextBefore === before) break;
      before = nextBefore;
    }

    return collected;
  }
}
