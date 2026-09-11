import { Logger } from '@nestjs/common';
import { AccountPlatform, Account } from '../../db/entities/account.entity';
import {
  AccountInfo,
  AccountStats,
  AvatarImage,
  ConnectorPost,
  SocialConnector,
} from '../connector.interface';
import { TelegramApiClient } from './telegram-api.client';
import { TelegramPreviewClient } from './telegram-preview.client';
import {
  parsePreviewPage,
  ParsedPreviewPost,
  PreviewUnavailableError,
} from './telegram-preview.parser';

const MAX_PAGES = 25;
const PAGE_DELAY_MS = 300;

/** Embed pages cost one request per post, so a sync stops here however long its window is. */
const MAX_EMBED_REQUESTS = 300;
/** Ids checked at each search probe, so one deleted post there doesn't read as "past the newest". */
const PROBE_SPAN = 4;
/** Missing ids in a row, scanning upward, that mean the newest post has been passed. */
const MISSING_RUN_LIMIT = 10;
/** Channel post ids start at 1; if nothing exists below this, the channel has no readable posts. */
const FIRST_POST_SEARCH_LIMIT = 1024;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class EmbedBudgetExhausted extends Error {}

function toConnectorPost(post: ParsedPreviewPost): ConnectorPost {
  return {
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
  };
}

export class TelegramConnector implements SocialConnector {
  platform = AccountPlatform.TELEGRAM;
  private readonly logger = new Logger(TelegramConnector.name);

  constructor(
    private client: TelegramApiClient,
    private preview: TelegramPreviewClient,
    private requestDelayMs = PAGE_DELAY_MS,
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
    // Stays true unless the loop below breaks for a reason other than exhausting
    // MAX_PAGES: reaching sinceDate, the end of the channel's history, or a
    // stuck cursor. If it's still true once the loop ends, the walk was cut off
    // by the page cap while there was more (possibly in-window) history left.
    let hitPageCap = true;

    for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber++) {
      if (pageNumber > 0) await delay(this.requestDelayMs);

      let parsed;
      try {
        const html = await this.preview.fetchPage(channel, before);
        parsed = parsePreviewPage(html, channel.replace(/^@/, ''));
      } catch (err) {
        // The first page throwing PreviewUnavailableError means the channel's preview
        // is unreadable altogether — usually because the owner disabled it, which
        // makes t.me/s/ redirect to a page with no posts. Each post's embed page is
        // still served, so read those instead; if they fail too, that must still fail
        // loudly so the sync job is marked failed and BullMQ retries.
        // The SAME error on a later page just means we've walked past the start of
        // the channel's history, which is a normal way for the walk to end, not a
        // failure — stop and return what was already collected. Any other error
        // (network, timeout, ...) always propagates, on any page.
        if (err instanceof PreviewUnavailableError) {
          if (pageNumber === 0)
            return this.getPostsFromEmbeds(channel, sinceDate, err);
          hitPageCap = false;
          break;
        }
        throw err;
      }

      // The last page of a channel's history can be requested again with the same
      // cursor (or, in tests, a mock that keeps handing back the same fixture) —
      // skip posts already collected so the walk stays idempotent either way.
      for (const post of parsed) {
        if (seenIds.has(post.externalPostId)) continue;
        seenIds.add(post.externalPostId);
        collected.push(toConnectorPost(post));
      }

      const oldest = parsed.reduce((a, b) =>
        a.publishedAt <= b.publishedAt ? a : b,
      );
      if (oldest.publishedAt < sinceDate) {
        hitPageCap = false;
        break;
      }

      // The preview renders oldest-first, so the next page is requested with the
      // OLDEST id on this one. Using the last element would ask for posts older
      // than the newest one here, returning the same page forever.
      const nextBefore = oldest.externalPostId;
      if (nextBefore === before) {
        hitPageCap = false;
        break;
      }
      before = nextBefore;
    }

    if (hitPageCap) {
      // A channel posting often enough to fill all MAX_PAGES before the walk
      // reaches sinceDate loses the older part of its history window silently
      // unless this is logged — there is no other signal that it happened.
      this.logger.warn(
        `Hit the ${MAX_PAGES}-page cap for ${channel} before reaching the requested history window — older posts in that window were not collected.`,
      );
    }

    return collected;
  }

  /**
   * Reads a channel whose web preview is disabled, one embed page per post. Nothing
   * lists the post ids, so the newest one is found by probing, then the walk steps
   * down id by id until it passes sinceDate. Deleted ids are "Post not found" pages
   * and are skipped.
   */
  private async getPostsFromEmbeds(
    channel: string,
    sinceDate: Date,
    previewError: PreviewUnavailableError,
  ): Promise<ConnectorPost[]> {
    const handle = channel.replace(/^@/, '');
    const pages = new Map<number, ParsedPreviewPost | null>();
    let requests = 0;

    const read = async (id: number): Promise<ParsedPreviewPost | null> => {
      if (pages.has(id)) return pages.get(id)!;
      if (requests >= MAX_EMBED_REQUESTS) throw new EmbedBudgetExhausted();
      if (requests > 0) await delay(this.requestDelayMs);
      requests += 1;

      let post: ParsedPreviewPost | null;
      try {
        [post] = parsePreviewPage(
          await this.preview.fetchEmbed(channel, String(id)),
          handle,
        );
      } catch (err) {
        if (!(err instanceof PreviewUnavailableError)) throw err;
        post = null;
      }
      pages.set(id, post);
      return post;
    };

    const hasPostNear = async (id: number): Promise<boolean> => {
      for (let probe = id; probe < id + PROBE_SPAN; probe++) {
        if (await read(probe)) return true;
      }
      return false;
    };

    let newest = 0;
    try {
      // Double until there are no posts near the probe, then binary-search the gap:
      // a post is always near `low`, never near `high`.
      let low = 0;
      let high = 1;
      while (low > 0 || high <= FIRST_POST_SEARCH_LIMIT) {
        if (await hasPostNear(high)) {
          low = high;
          high *= 2;
        } else if (low === 0) {
          high *= 2;
        } else {
          break;
        }
      }
      if (low === 0) throw previewError;

      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (await hasPostNear(middle)) low = middle;
        else high = middle;
      }

      // A deleted post at a probe can still leave `low` short of the newest post;
      // scanning up until a long run of missing ids closes that gap.
      let missing = 0;
      for (let id = low; missing < MISSING_RUN_LIMIT; id++) {
        if (await read(id)) {
          newest = id;
          missing = 0;
        } else {
          missing += 1;
        }
      }
    } catch (err) {
      if (err instanceof EmbedBudgetExhausted) throw previewError;
      throw err;
    }

    const collected: ConnectorPost[] = [];
    // The preview page shows an album once, under its lowest id. All its parts share
    // one timestamp, but they need not be adjacent: another post sent in the same
    // second can take an id between them. So an album is keyed by its timestamp,
    // and each lower part walked into replaces the album's entry.
    const albumSlots = new Map<number, number>();
    try {
      for (let id = newest; id >= 1; id--) {
        const post = await read(id);
        if (!post) continue;
        if (post.publishedAt < sinceDate) break;

        const slot = post.grouped
          ? albumSlots.get(post.publishedAt.getTime())
          : undefined;
        if (slot !== undefined) {
          collected[slot] = toConnectorPost(post);
        } else {
          if (post.grouped)
            albumSlots.set(post.publishedAt.getTime(), collected.length);
          collected.push(toConnectorPost(post));
        }
      }
    } catch (err) {
      if (!(err instanceof EmbedBudgetExhausted)) throw err;
      this.logger.warn(
        `Read the ${MAX_EMBED_REQUESTS}-request limit of embed pages for ${channel} before reaching the requested history window — older posts in that window were not collected.`,
      );
    }

    return collected;
  }
}
