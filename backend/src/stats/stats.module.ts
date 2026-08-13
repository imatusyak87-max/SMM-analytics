import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../db/entities/account.entity';
import { AccountSnapshot } from '../db/entities/account-snapshot.entity';
import { Post } from '../db/entities/post.entity';
import { StatsService } from './stats.service';

@Module({
  imports: [TypeOrmModule.forFeature([Account, AccountSnapshot, Post])],
  providers: [StatsService],
  exports: [StatsService],
})
export class StatsModule {}
