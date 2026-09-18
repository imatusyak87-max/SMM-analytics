import { ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { In, MoreThan, Repository } from 'typeorm';
import { Queue } from 'bullmq';
import {
  CompetitorRun,
  CompetitorRunStatus,
  CompetitorRunTrigger,
} from '../db/entities/competitor-run.entity';

/** One retry, widely spaced: provider hiccups are transient, but each run is a real call. */
const RETRY_OPTIONS = { attempts: 2, backoff: { type: 'exponential' as const, delay: 60_000 } };

/**
 * A real run takes 1–2 minutes end to end. Redis has no volume in
 * docker-compose.prod.yml, so a redeploy wipes the queue: a PENDING row
 * enqueued but not yet picked up loses its job and never resolves. Anything
 * older than this has certainly lost its job, not just run long — ignore it
 * so it can never block a new run forever.
 */
const STALE_RUN_MS = 15 * 60_000;

export const COMPETITOR_CONFIG = Symbol('COMPETITOR_CONFIG');

export interface CompetitorConfig {
  provider: string;
  model: string;
  enabled: boolean;
}

@Injectable()
export class CompetitorRunService {
  constructor(
    @InjectRepository(CompetitorRun) private runsRepo: Repository<CompetitorRun>,
    @InjectQueue('competitors') private queue: Queue,
    @Inject(COMPETITOR_CONFIG) private config: CompetitorConfig,
  ) {}

  isEnabled(): boolean {
    return this.config.enabled;
  }

  async createManual(accountId: string): Promise<CompetitorRun> {
    if (!this.config.enabled) {
      throw new ServiceUnavailableException('Подбор конкурентов не настроен');
    }
    if (await this.activeRun(accountId)) {
      throw new ConflictException('Подбор конкурентов уже выполняется');
    }
    return this.enqueue(accountId, CompetitorRunTrigger.MANUAL);
  }

  /**
   * Fired after an account's first sync. The guard is "this account has no run
   * yet", not the sync trigger, so the nightly sync can never re-run discovery.
   */
  async createForNewAccount(accountId: string): Promise<CompetitorRun | null> {
    if (!this.config.enabled) return null;
    if ((await this.runsRepo.count({ where: { accountId } })) > 0) return null;
    if (await this.activeRun(accountId)) return null;
    return this.enqueue(accountId, CompetitorRunTrigger.ACCOUNT_ADDED);
  }

  findLatest(accountId: string): Promise<CompetitorRun | null> {
    return this.runsRepo.findOne({ where: { accountId }, order: { createdAt: 'DESC' } });
  }

  private activeRun(accountId: string): Promise<CompetitorRun | null> {
    return this.runsRepo.findOne({
      where: {
        accountId,
        status: In([CompetitorRunStatus.PENDING, CompetitorRunStatus.RUNNING]),
        createdAt: MoreThan(new Date(Date.now() - STALE_RUN_MS)),
      },
    });
  }

  private async enqueue(accountId: string, trigger: CompetitorRunTrigger): Promise<CompetitorRun> {
    const run = await this.runsRepo.save(
      this.runsRepo.create({
        accountId,
        trigger,
        status: CompetitorRunStatus.PENDING,
        llmProvider: this.config.provider,
        llmModel: this.config.model,
      }),
    );
    await this.queue.add('find-competitors', { runId: run.id, accountId }, RETRY_OPTIONS);
    return run;
  }
}
