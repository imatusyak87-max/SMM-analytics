import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { ConnectorRegistry } from '../connectors/connector-registry.service';
import { Account } from '../db/entities/account.entity';
import { AccountSnapshot } from '../db/entities/account-snapshot.entity';
import { Post } from '../db/entities/post.entity';
import { SyncJob, SyncStatus } from '../db/entities/sync-job.entity';
import { calculateEr } from './er-calculator';

interface SyncJobData {
  syncJobId: string;
  accountId: string;
}

@Processor('sync')
export class SyncProcessor extends WorkerHost {
  constructor(
    private registry: ConnectorRegistry,
    @InjectRepository(Account) private accountsRepo: Repository<Account>,
    @InjectRepository(AccountSnapshot) private snapshotsRepo: Repository<AccountSnapshot>,
    @InjectRepository(Post) private postsRepo: Repository<Post>,
    @InjectRepository(SyncJob) private syncJobsRepo: Repository<SyncJob>,
  ) {
    super();
  }

  async process(job: Job<SyncJobData>): Promise<void> {
    const { syncJobId, accountId } = job.data;
    await this.syncJobsRepo.update(syncJobId, { status: SyncStatus.RUNNING, startedAt: new Date() });

    try {
      const account = await this.accountsRepo.findOneBy({ id: accountId });
      if (!account) throw new Error(`Account ${accountId} not found`);

      const connector = this.registry.get(account.platform);
      const stats = await connector.getAccountStats(account);
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const posts = await connector.getPosts(account, since);

      const today = new Date().toISOString().slice(0, 10);
      let erSum = 0;
      let erCount = 0;

      for (const post of posts) {
        const er = calculateEr(post.likes, post.comments, post.shares, stats.followersCount);
        if (er !== null) {
          erSum += er;
          erCount += 1;
        }
        await this.postsRepo.upsert(
          { accountId, ...post, er, lastSyncedAt: new Date() },
          ['accountId', 'externalPostId'],
        );
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
    } catch (error) {
      await this.syncJobsRepo.update(syncJobId, {
        status: SyncStatus.FAILED,
        errorMessage: (error as Error).message,
        finishedAt: new Date(),
      });
    }
  }
}
