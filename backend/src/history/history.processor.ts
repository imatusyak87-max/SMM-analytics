import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { HistoryRunner } from './history-runner';
import { HistoryLoadService } from './history-load.service';

/** Concurrency 1: one account's history load at a time, app-wide. */
@Processor('history', { concurrency: 1 })
export class HistoryProcessor extends WorkerHost {
  constructor(
    private runner: HistoryRunner,
    private loads: HistoryLoadService,
  ) {
    super();
  }

  async process(job: Job<{ accountId: string }>): Promise<void> {
    const next = await this.runner.runSlice(job.data.accountId);
    if (next !== null) await this.loads.enqueue(job.data.accountId, next);
  }
}
