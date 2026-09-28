import { BadRequestException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { In, Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { Account } from '../db/entities/account.entity';
import {
  HistoryLoad,
  HistoryLoadPhase,
  HistoryLoadStatus,
  HistoryPauseReason,
} from '../db/entities/history-load.entity';
import { ConnectorRegistry } from '../connectors/connector-registry.service';

export interface HistoryLoadView {
  status: HistoryLoadStatus;
  phase: HistoryLoadPhase;
  postsLoaded: number;
  oldestPostAt: Date | null;
  insightsDone: number;
  insightsTotal: number;
  pausedUntil: Date | null;
  pauseReason: HistoryPauseReason | null;
  errorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

/** What the page sees: progress, never the internal cursor. */
export function toView(load: HistoryLoad): HistoryLoadView {
  return {
    status: load.status,
    phase: load.phase,
    postsLoaded: load.postsLoaded,
    oldestPostAt: load.oldestPostAt ?? null,
    insightsDone: load.insightsDone,
    insightsTotal: load.insightsTotal,
    pausedUntil: load.pausedUntil ?? null,
    pauseReason: load.pauseReason ?? null,
    errorMessage: load.errorMessage ?? null,
    startedAt: load.startedAt ?? null,
    finishedAt: load.finishedAt ?? null,
  };
}

const OPEN_STATUSES = [HistoryLoadStatus.QUEUED, HistoryLoadStatus.RUNNING, HistoryLoadStatus.PAUSED];

@Injectable()
export class HistoryLoadService implements OnApplicationBootstrap {
  private readonly logger = new Logger(HistoryLoadService.name);

  constructor(
    @InjectRepository(HistoryLoad) private loadsRepo: Repository<HistoryLoad>,
    @InjectRepository(Account) private accountsRepo: Repository<Account>,
    private registry: ConnectorRegistry,
    @InjectQueue('history') private queue: Queue,
  ) {}

  async start(accountId: string): Promise<HistoryLoadView> {
    const account = await this.accountsRepo.findOneBy({ id: accountId });
    if (!account) throw new NotFoundException('Аккаунт не найден');
    if (typeof this.registry.get(account.platform).loadHistoryPage !== 'function') {
      throw new BadRequestException('Для этой платформы загрузка истории недоступна');
    }

    const existing = await this.loadsRepo.findOneBy({ accountId });
    if (existing && OPEN_STATUSES.includes(existing.status)) return toView(existing);

    let load: HistoryLoad;
    if (existing && existing.status === HistoryLoadStatus.FAILED) {
      // «Продолжить»: keep cursor, phase and counters.
      load = { ...existing, status: HistoryLoadStatus.QUEUED, errorMessage: null, finishedAt: null };
    } else {
      // First run, or «Обновить всю историю» after a finished one.
      load = this.loadsRepo.create({
        ...(existing ?? {}),
        accountId,
        status: HistoryLoadStatus.QUEUED,
        phase: HistoryLoadPhase.POSTS,
        cursor: null,
        postsLoaded: 0,
        oldestPostAt: null,
        insightsDone: 0,
        insightsTotal: 0,
        pausedUntil: null,
        pauseReason: null,
        errorMessage: null,
        startedAt: null,
        finishedAt: null,
      });
    }
    const saved = await this.loadsRepo.save(load);
    await this.enqueue(accountId, 0);
    return toView(saved);
  }

  async get(accountId: string): Promise<HistoryLoadView | null> {
    const load = await this.loadsRepo.findOneBy({ accountId });
    return load ? toView(load) : null;
  }

  async enqueue(accountId: string, delayMs: number): Promise<void> {
    await this.queue.add('history-slice', { accountId }, { delay: delayMs, removeOnComplete: true, removeOnFail: true });
  }

  onApplicationBootstrap(): Promise<void> {
    return this.resumeStranded();
  }

  /** A load whose next slice was lost (e.g. Redis flushed) would otherwise sit «running» forever. */
  async resumeStranded(): Promise<void> {
    try {
      const open = await this.loadsRepo.find({ where: { status: In(OPEN_STATUSES) } });
      if (open.length === 0) return;
      const jobs = await this.queue.getJobs(['waiting', 'delayed', 'active', 'prioritized']);
      const pending = new Set(jobs.map((job) => job?.data?.accountId));
      for (const load of open) {
        if (pending.has(load.accountId)) continue;
        const wait =
          load.status === HistoryLoadStatus.PAUSED && load.pausedUntil
            ? Math.max(0, load.pausedUntil.getTime() - Date.now())
            : 0;
        await this.enqueue(load.accountId, wait);
      }
    } catch (error) {
      this.logger.warn(`Could not resume unfinished history loads: ${(error as Error).message}`);
    }
  }
}
