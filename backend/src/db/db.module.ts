import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Account } from './entities/account.entity';
import { AccountCredential } from './entities/account-credential.entity';
import { AccountSnapshot } from './entities/account-snapshot.entity';
import { Post } from './entities/post.entity';
import { SyncJob } from './entities/sync-job.entity';
import { CompetitorRun } from './entities/competitor-run.entity';
import { CompetitorSuggestion } from './entities/competitor-suggestion.entity';
import { CompetitorRejection } from './entities/competitor-rejection.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [User, Account, AccountCredential, AccountSnapshot, Post, SyncJob, CompetitorRun, CompetitorSuggestion, CompetitorRejection],
      synchronize: process.env.NODE_ENV === 'test',
    }),
    TypeOrmModule.forFeature([User, Account, AccountCredential, AccountSnapshot, Post, SyncJob, CompetitorRun, CompetitorSuggestion, CompetitorRejection]),
  ],
  exports: [TypeOrmModule],
})
export class DbModule {}
