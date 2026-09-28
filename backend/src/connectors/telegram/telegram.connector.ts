import { Logger } from '@nestjs/common';
import { AccountPlatform, Account } from '../../db/entities/account.entity';
import {
  AccountInfo,
  AccountStats,
  AvatarImage,
  ConnectorPost,
  HistoryPage,
  LatestPost,
  SocialConnector,
} from '../connector.interface';
import { HistoryPauseError, isNetworkError, MINUTE_MS, networkPause } from '../history-pause.error';
import { HistoryPauseReason } from '../../db/entities/history-load.entity';
import { TelegramApiClient } from './telegram-api.client';
import { TelegramPreviewClient } from './telegram-preview.client';
import {
  isChannelPostList,
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
/** Embed ids read per history call; the processor paces calls into slices. */
const EMBED_HISTORY_CHUNK = 50;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class EmbedBudgetExhausted extends Error {}

function toTelegramPause(err: unknown): unknown {
  if (err instanceof HistoryPauseError) return err;
  if ((err as { response?: { status?: number } })?.response?.status === 429) {
    return new HistoryPauseError(
      HistoryPauseReason.TELEGRAM_RATE_LIMIT,
      5 * MINUTE_MS,
      'Telegram ограничил запросы, продолжим через 5 минут',
    );
  }
  if (isNetworkError(err)) return networkPause();
  return err;
}

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
    return {
      name: chat.title,
      avatarUrl: chat.photoUrl,
      description: chat.description,
      isChannel: chat.type === 'channel',
    };
  }

  async getAvatar(fileRef: string): Promise<AvatarImage> {
    return this.client.downloadFile(fileRef);
  }

  /**
   * One preview page is enough: it shows the channel's newest posts. A page with
   * no posts is either an empty channel ('none') or a hidden preview (null,
   * unknown), told apart by whether the channel's post list is there at all.
   * Network errors propagate so a caller can tell "we could not ask" apart from
   * "the channel will not say".
   */
  async getLatestPostAt(account: Account): Promise<LatestPost> {
    const channel = account.externalId;
    const html = await this.preview.fetchPage(channel);
    try {
      const posts = parsePreviewPage(html, channel.replace(/^@/, ''));
      return new Date(Math.max(...posts.map((post) => post.publishedAt.getTime())));
    } catch (err) {
      if (err instanceof PreviewUnavailableError) return isChannelPostList(html) ? 'none' : null;
      throw err;
    }
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

  /** Reads embed pages with a per-walk request budget, pacing and caching each id. */
  private makeEmbedReader(channel: string, budget: number): (id: number) => Promise<ParsedPreviewPost | null> {
    const handle = channel.replace(/^@/, '');
    const pages = new Map<number, ParsedPreviewPost | null>();
    let requests = 0;

    return async (id: number) => {
      if (pages.has(id)) return pages.get(id)!;
      if (requests >= budget) throw new EmbedBudgetExhausted();
      if (requests > 0) await delay(this.requestDelayMs);
      requests += 1;

      let post: ParsedPreviewPost | null;
      try {
        [post] = parsePreviewPage(await this.preview.fetchEmbed(channel, String(id)), handle);
      } catch (err) {
        if (!(err instanceof PreviewUnavailableError)) throw err;
        post = null;
      }
      pages.set(id, post);
      return post;
    };
  }

  /**
   * Nothing lists a hidden channel's post ids, so the newest one is found by
   * probing: double until no post is near, binary-search the gap, then scan up
   * past deleted ids. Throws `previewError` when the channel has no readable posts.
   */
  private async findNewestEmbedId(
    read: (id: number) => Promise<ParsedPreviewPost | null>,
    previewError: PreviewUnavailableError,
  ): Promise<number> {
    const hasPostNear = async (id: number): Promise<boolean> => {
      for (let probe = id; probe < id + PROBE_SPAN; probe++) {
        if (await read(probe)) return true;
      }
      return false;
    };

    try {
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

      let newest = 0;
      let missing = 0;
      for (let id = low; missing < MISSING_RUN_LIMIT; id++) {
        if (await read(id)) {
          newest = id;
          missing = 0;
        } else {
          missing += 1;
        }
      }
      return newest;
    } catch (err) {
      if (err instanceof EmbedBudgetExhausted) throw previewError;
      throw err;
    }
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
    const read = this.makeEmbedReader(channel, MAX_EMBED_REQUESTS);
    const newest = await this.findNewestEmbedId(read, previewError);

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

        const slot = post.grouped ? albumSlots.get(post.publishedAt.getTime()) : undefined;
        if (slot !== undefined) {
          collected[slot] = toConnectorPost(post);
        } else {
          if (post.grouped) albumSlots.set(post.publishedAt.getTime(), collected.length);
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

  /**
   * One step of the full-history walk. Normal channels page back through
   * t.me/s/ with no page cap; channels with the preview disabled are read one
   * embed page per post, all the way down to id 1.
   */
  async loadHistoryPage(account: Account, cursor: string | null): Promise<HistoryPage> {
    const channel = account.externalId;
    try {
      if (cursor?.startsWith('e:')) return await this.embedHistoryChunk(channel, Number(cursor.slice(2)));
      return await this.previewHistoryPage(channel, cursor?.startsWith('p:') ? cursor.slice(2) : undefined);
    } catch (err) {
      throw toTelegramPause(err);
    }
  }

  private async previewHistoryPage(channel: string, before: string | undefined): Promise<HistoryPage> {
    let parsed: ParsedPreviewPost[];
    try {
      parsed = parsePreviewPage(await this.preview.fetchPage(channel, before), channel.replace(/^@/, ''));
    } catch (err) {
      if (!(err instanceof PreviewUnavailableError)) throw err;
      // On the first page this means the preview is disabled: switch to embeds.
      // Later, it means the walk went past the channel's first post.
      if (before !== undefined) return { posts: [], nextCursor: null };
      const newest = await this.findNewestEmbedId(this.makeEmbedReader(channel, MAX_EMBED_REQUESTS), err);
      return this.embedHistoryChunk(channel, newest);
    }

    const oldest = parsed.reduce((a, b) => (a.publishedAt <= b.publishedAt ? a : b));
    const nextBefore = oldest.externalPostId;
    return {
      posts: parsed.map(toConnectorPost),
      nextCursor: nextBefore === before ? null : `p:${nextBefore}`,
    };
  }

  /**
   * Reads up to EMBED_HISTORY_CHUNK ids downward from `startId`. Deleted ids
   * are skipped without ending the walk. The chunk never stops inside an
   * album, so an album is never split into two posts across chunks.
   */
  private async embedHistoryChunk(channel: string, startId: number): Promise<HistoryPage> {
    const read = this.makeEmbedReader(channel, Number.POSITIVE_INFINITY);
    const collected: ConnectorPost[] = [];
    const albumSlots = new Map<number, number>();
    let openAlbum: number | null = null;
    let reads = 0;
    let id = startId;

    while (id >= 1) {
      if (reads >= EMBED_HISTORY_CHUNK && openAlbum === null) break;
      const post = await read(id);
      reads += 1;

      if (!post) {
        if (reads > EMBED_HISTORY_CHUNK) openAlbum = null;
        id -= 1;
        continue;
      }

      const time = post.publishedAt.getTime();
      if (reads > EMBED_HISTORY_CHUNK && !(post.grouped && time === openAlbum)) {
        break; // past the budget and outside the album: this id starts the next chunk
      }

      const slot = post.grouped ? albumSlots.get(time) : undefined;
      if (slot !== undefined) {
        collected[slot] = toConnectorPost(post);
      } else {
        if (post.grouped) albumSlots.set(time, collected.length);
        collected.push(toConnectorPost(post));
      }
      openAlbum = post.grouped ? time : null;
      id -= 1;
    }

    return { posts: collected, nextCursor: id >= 1 ? `e:${id}` : null };
  }
}
