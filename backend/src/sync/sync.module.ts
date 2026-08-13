import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncJob } from '../db/entities/sync-job.entity';
import { Account } from '../db/entities/account.entity';
import { AccountSnapshot } from '../db/entities/account-snapshot.entity';
import { Post } from '../db/entities/post.entity';
import { SyncJobService } from './sync-job.service';
import { SyncProcessor } from './sync.processor';
import { ConnectorsModule } from '../connectors/connectors.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'sync' }),
    TypeOrmModule.forFeature([Account, AccountSnapshot, Post, SyncJob]),
    ConnectorsModule,
  ],
  providers: [SyncJobService, SyncProcessor],
  exports: [SyncJobService],
})
export class SyncModule {}
