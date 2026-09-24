import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { ConnectorRegistry } from '../connectors/connector-registry.service';
import { Account, AccountPlatform } from '../db/entities/account.entity';
import { AccountSnapshot } from '../db/entities/account-snapshot.entity';
import { Post } from '../db/entities/post.entity';
import { SyncJob, SyncStatus } from '../db/entities/sync-job.entity';
import { calculateEr, calculateErByViews } from './er-calculator';
import { POST_HISTORY_DAYS } from './history-window';
import { CompetitorRunService } from '../competitors/competitor-run.service';

interface SyncJobData {
  syncJobId: string;
  accountId: string;
}

function isFinalAttempt(job: Job<SyncJobData>): boolean {
  const allowed = job.opts?.attempts ?? 1;
  return (job.attemptsMade ?? 0) + 1 >= allowed;
}

@Processor('sync')
export class SyncProcessor extends WorkerHost {
  private readonly logger = new Logger(SyncProcessor.name);

  constructor(
    private registry: ConnectorRegistry,
    @InjectRepository(Account) private accountsRepo: Repository<Account>,
    @InjectRepository(AccountSnapshot) private snapshotsRepo: Repository<AccountSnapshot>,
    @InjectRepository(Post) private postsRepo: Repository<Post>,
    @InjectRepository(SyncJob) private syncJobsRepo: Repository<SyncJob>,
    private competitorRuns: CompetitorRunService,
  ) {
    super();
  }

  async process(job: Job<SyncJobData>): Promise<void> {
    const { syncJobId, accountId } = job.data;
    let platform: AccountPlatform | null = null;

    try {
      await this.syncJobsRepo.update(syncJobId, { status: SyncStatus.RUNNING, startedAt: new Date() });

      const account = await this.accountsRepo.findOneBy({ id: accountId });
      if (!account) throw new Error(`Account ${accountId} not found`);
      platform = account.platform;

      const connector = this.registry.get(account.platform);
      const stats = await connector.getAccountStats(account);
      const since = new Date();
      since.setDate(since.getDate() - POST_HISTORY_DAYS);
      const today = new Date().toISOString().slice(0, 10);

      let erSum = 0;
      let erCount = 0;

      try {
        const posts = await connector.getPosts(account, since);

        for (const post of posts) {
          const er = calculateEr(post.likes, post.comments, post.shares, stats.followersCount);
          const erViews = calculateErByViews(post.likes, post.views);
          if (er !== null) {
            erSum += er;
            erCount += 1;
          }
          await this.postsRepo.upsert(
            { accountId, ...post, er, erViews, lastSyncedAt: new Date() },
            ['accountId', 'externalPostId'],
          );
        }
      } catch (postsError) {
        // A t.me timeout, a 429 during the batch, or a channel whose preview is
        // hidden must not also wipe today's follower snapshot — the snapshot is
        // independent of post scraping and would otherwise stop for good on a
        // channel whose preview never recovers. Write it with avgEr: null (same
        // as a day with zero posts), then rethrow so the job still fails and
        // BullMQ still retries.
        await this.snapshotsRepo.upsert(
          {
            accountId,
            date: today,
            followersCount: stats.followersCount,
            followingCount: stats.followingCount,
            postsCount: stats.postsCount,
            avgReach: null,
            avgEr: null,
          },
          ['accountId', 'date'],
        );
        throw postsError;
      }

      await this.snapshotsRepo.upsert(
        {
          accountId,
          date: today,
          followersCount: stats.followersCount,
          followingCount: stats.followingCount,
          postsCount: stats.postsCount,
          avgReach: null,
          avgEr: erCount > 0 ? erSum / erCount : null,
        },
        ['accountId', 'date'],
      );

      await this.syncJobsRepo.update(syncJobId, { status: SyncStatus.SUCCESS, finishedAt: new Date() });
      await this.startCompetitorDiscovery(accountId, platform);
    } catch (error) {
      // Only the last attempt is a real failure — marking earlier ones FAILED would
      // show the user a failure that a retry is about to fix.
      if (isFinalAttempt(job)) {
        try {
          await this.syncJobsRepo.update(syncJobId, {
            status: SyncStatus.FAILED,
            errorMessage: (error as Error).message,
            finishedAt: new Date(),
          });
        } catch (updateError) {
          this.logger.error(
            `Failed to record FAILED status for sync job ${syncJobId} after original error: ${
              (error as Error).message
            }`,
            (updateError as Error).stack,
          );
        }

        await this.startCompetitorDiscovery(accountId, platform);
      }

      // BullMQ decides retry and backoff from a rejected promise; swallowing here
      // marked every failed job successful.
      throw error;
    }
  }

  /**
   * Discovery needs captions, which exist only after a sync. The guard inside
   * createForNewAccount is "this account has no run yet", so the nightly sync
   * never re-runs it. Queueing must never turn a finished sync into a failed one.
   */
  private async startCompetitorDiscovery(accountId: string, platform: AccountPlatform | null): Promise<void> {
    // Discovery asks the LLM for similar Telegram channels — meaningless for
    // any other platform. An unknown platform (account never loaded) keeps
    // the previous behaviour.
    if (platform !== null && platform !== AccountPlatform.TELEGRAM) return;
    try {
      await this.competitorRuns.createForNewAccount(accountId);
    } catch (error) {
      this.logger.warn(`Could not queue competitor discovery for ${accountId}: ${(error as Error).message}`);
    }
  }
}
