import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncJob } from '../db/entities/sync-job.entity';
import { Account } from '../db/entities/account.entity';
import { SyncJobService } from './sync-job.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'sync' }),
    TypeOrmModule.forFeature([SyncJob, Account]),
  ],
  providers: [SyncJobService],
  exports: [SyncJobService],
})
export class SyncModule {}
