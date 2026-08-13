import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Account } from './entities/account.entity';
import { AccountCredential } from './entities/account-credential.entity';
import { AccountSnapshot } from './entities/account-snapshot.entity';
import { Post } from './entities/post.entity';
import { SyncJob } from './entities/sync-job.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [User, Account, AccountCredential, AccountSnapshot, Post, SyncJob],
      synchronize: process.env.NODE_ENV === 'test',
    }),
    TypeOrmModule.forFeature([User, Account, AccountCredential, AccountSnapshot, Post, SyncJob]),
  ],
  exports: [TypeOrmModule],
})
export class DbModule {}
