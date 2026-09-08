import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SyncJobService } from './sync-job.service';

@Injectable()
export class SyncScheduler {
  constructor(private syncJobService: SyncJobService) {}

  @Cron('0 3 * * *')
  async triggerDailySync(): Promise<void> {
    await this.syncJobService.createScheduledForAllActiveAccounts();
  }
}
