import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../db/entities/account.entity';
import { AccountSnapshot } from '../db/entities/account-snapshot.entity';
import { HistoryLoad } from '../db/entities/history-load.entity';
import { Post } from '../db/entities/post.entity';
import { ConnectorsModule } from '../connectors/connectors.module';
import { HistoryController } from './history.controller';
import { HistoryLoadService } from './history-load.service';
import { HistoryPostStore } from './history-post-store';
import { HistoryProcessor } from './history.processor';
import { HistoryRunner } from './history-runner';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'history' }),
    TypeOrmModule.forFeature([HistoryLoad, Account, AccountSnapshot, Post]),
    ConnectorsModule,
  ],
  controllers: [HistoryController],
  providers: [HistoryPostStore, HistoryRunner, HistoryLoadService, HistoryProcessor],
})
export class HistoryModule {}
