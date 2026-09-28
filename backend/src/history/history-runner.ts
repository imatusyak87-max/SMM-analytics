import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '../db/entities/account.entity';
import { AccountSnapshot } from '../db/entities/account-snapshot.entity';
import { HistoryLoad, HistoryLoadPhase, HistoryLoadStatus } from '../db/entities/history-load.entity';
import { ConnectorRegistry } from '../connectors/connector-registry.service';
import { SocialConnector } from '../connectors/connector.interface';
import { HistoryPauseError } from '../connectors/history-pause.error';
import { POST_HISTORY_DAYS } from '../sync/history-window';
import { HistoryPostStore, insightCursor } from './history-post-store';

export const HISTORY_TIMING = 'HISTORY_TIMING';

export interface HistoryTiming {
  /** Pause between history pages inside one slice. */
  unitDelayMs: number;
  /** Pause between Instagram insight requests (~1/s keeps well inside the rolling limit). */
  insightDelayMs: number;
}

const DEFAULT_TIMING: HistoryTiming = { unitDelayMs: 300, insightDelayMs: 1000 };

/** History pages per slice; each slice is a short BullMQ job. */
export const POSTS_UNITS_PER_SLICE = 10;
/** Insight requests per slice (~1 minute at the default pace). */
export const INSIGHTS_PER_SLICE = 60;

const DAY_MS = 86_400_000;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The panel shows errorMessage verbatim; fall back rather than leak an English/driver error to the user. */
const userFacingMessage = (message: string): string => (/[А-Яа-яЁё]/.test(message) ? message : 'непредвиденная ошибка');

/**
 * Runs one slice of an account's full-history load and records progress after
 * every page or post, so a pause, failure or restart loses nothing.
 */
@Injectable()
export class HistoryRunner {
  private readonly timing: HistoryTiming;
  private readonly logger = new Logger(HistoryRunner.name);

  constructor(
    @InjectRepository(HistoryLoad) private loadsRepo: Repository<HistoryLoad>,
    @InjectRepository(Account) private accountsRepo: Repository<Account>,
    @InjectRepository(AccountSnapshot) private snapshotsRepo: Repository<AccountSnapshot>,
    private registry: ConnectorRegistry,
    private store: HistoryPostStore,
    @Optional() @Inject(HISTORY_TIMING) timing?: HistoryTiming,
  ) {
    this.timing = timing ?? DEFAULT_TIMING;
  }

  /** Returns the delay before the next slice, or null when there is nothing more to do. */
  async runSlice(accountId: string): Promise<number | null> {
    const load = await this.loadsRepo.findOneBy({ accountId });
    if (!load || load.status === HistoryLoadStatus.DONE || load.status === HistoryLoadStatus.FAILED) return null;
    const account = await this.accountsRepo.findOneBy({ id: accountId });
    if (!account) return null;
    const connector = this.registry.get(account.platform);

    load.status = HistoryLoadStatus.RUNNING;
    load.pausedUntil = null;
    load.pauseReason = null;
    load.startedAt = load.startedAt ?? new Date();
    await this.persist(load);

    try {
      const followers = await this.followersFor(account, connector);
      if (load.phase === HistoryLoadPhase.POSTS) await this.postsSlice(load, account, connector, followers);
      else await this.insightsSlice(load, account, connector, followers);
      // postsSlice/insightsSlice mutate load.status; TS doesn't see through the call, so widen the narrowed literal.
      return (load.status as HistoryLoadStatus) === HistoryLoadStatus.DONE ? null : 0;
    } catch (error) {
      if (error instanceof HistoryPauseError) {
        load.status = HistoryLoadStatus.PAUSED;
        load.pauseReason = error.reason;
        load.pausedUntil = new Date(Date.now() + error.retryAfterMs);
        await this.persist(load);
        return error.retryAfterMs;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`History load for account ${accountId} failed: ${message}`);
      load.status = HistoryLoadStatus.FAILED;
      load.errorMessage = userFacingMessage(message);
      load.finishedAt = new Date();
      await this.persist(load);
      return null;
    }
  }

  private async postsSlice(load: HistoryLoad, account: Account, connector: SocialConnector, followers: number) {
    const preserveInsights = typeof connector.loadPostInsights === 'function';
    for (let unit = 0; unit < POSTS_UNITS_PER_SLICE; unit++) {
      if (unit > 0) await delay(this.timing.unitDelayMs);
      const page = await connector.loadHistoryPage!(account, load.cursor);
      await this.store.write(account.id, page.posts, followers, preserveInsights);

      load.postsLoaded += page.posts.length;
      for (const post of page.posts) {
        if (!load.oldestPostAt || post.publishedAt < load.oldestPostAt) load.oldestPostAt = post.publishedAt;
      }
      load.cursor = page.nextCursor;

      if (page.nextCursor === null) {
        await this.finishPostsPhase(load, account, preserveInsights);
        return;
      }
      await this.persist(load);
    }
  }

  private async finishPostsPhase(load: HistoryLoad, account: Account, hasInsightsPhase: boolean) {
    const total = hasInsightsPhase ? await this.store.countInsightTargets(account.id, this.windowStart()) : 0;
    if (total > 0) {
      load.phase = HistoryLoadPhase.INSIGHTS;
      load.cursor = null;
      load.insightsDone = 0;
      load.insightsTotal = total;
    } else {
      load.status = HistoryLoadStatus.DONE;
      load.finishedAt = new Date();
    }
    await this.persist(load);
  }

  private async insightsSlice(load: HistoryLoad, account: Account, connector: SocialConnector, followers: number) {
    const targets = await this.store.nextInsightTargets(account.id, this.windowStart(), load.cursor, INSIGHTS_PER_SLICE);
    for (let i = 0; i < targets.length; i++) {
      if (i > 0) await delay(this.timing.insightDelayMs);
      const post = targets[i];
      const insights = await connector.loadPostInsights!(account, post.externalPostId);
      await this.store.saveInsights(post, insights, followers);
      load.insightsDone += 1;
      load.cursor = insightCursor(post);
      await this.persist(load);
    }
    if (targets.length < INSIGHTS_PER_SLICE) {
      load.status = HistoryLoadStatus.DONE;
      load.finishedAt = new Date();
      await this.persist(load);
    }
  }

  /** ER needs a follower count; today's is the best there is for old posts. */
  private async followersFor(account: Account, connector: SocialConnector): Promise<number> {
    const latest = await this.snapshotsRepo.findOne({ where: { accountId: account.id }, order: { date: 'DESC' } });
    if (latest) return latest.followersCount;
    return (await connector.getAccountStats(account)).followersCount;
  }

  /** Posts newer than this are the nightly sync's job. */
  private windowStart(): Date {
    return new Date(Date.now() - POST_HISTORY_DAYS * DAY_MS);
  }

  /** update(), not save(): save() would re-insert a row deleted with its account. */
  private async persist(load: HistoryLoad): Promise<void> {
    const fields: Partial<HistoryLoad> = { ...load };
    delete fields.id;
    delete fields.accountId;
    await this.loadsRepo.update({ id: load.id }, fields);
  }
}
