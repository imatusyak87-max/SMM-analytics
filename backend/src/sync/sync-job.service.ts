import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { SyncJob, SyncTrigger, SyncStatus } from '../db/entities/sync-job.entity';
import { Account } from '../db/entities/account.entity';

/**
 * A sync failure is usually transient (Telegram rate limit, a network blip), so the
 * job gets three widely spaced attempts before it is reported as failed.
 */
const RETRY_OPTIONS = { attempts: 3, backoff: { type: 'exponential' as const, delay: 30_000 } };

@Injectable()
export class SyncJobService {
  constructor(
    @InjectRepository(SyncJob) private syncJobsRepo: Repository<SyncJob>,
    @InjectQueue('sync') private queue: Queue,
    @InjectRepository(Account) private accountsRepo?: Repository<Account>,
  ) {}

  async createManual(accountId: string): Promise<SyncJob> {
    return this.enqueue(accountId, SyncTrigger.MANUAL, 1);
  }

  async createScheduledForAllActiveAccounts(): Promise<SyncJob[]> {
    const accounts = await this.accountsRepo!.find({ where: { isActive: true } });
    const jobs: SyncJob[] = [];
    for (const account of accounts) {
      jobs.push(await this.enqueue(account.id, SyncTrigger.SCHEDULED, 10));
    }
    return jobs;
  }

  async findById(id: string): Promise<SyncJob | null> {
    return this.syncJobsRepo.findOneBy({ id });
  }

  private async enqueue(accountId: string, trigger: SyncTrigger, priority: number): Promise<SyncJob> {
    const job = await this.syncJobsRepo.save(
      this.syncJobsRepo.create({ accountId, trigger, status: SyncStatus.PENDING }),
    );
    await this.queue.add('sync-account', { syncJobId: job.id, accountId }, { priority, ...RETRY_OPTIONS });
    return job;
  }
}
