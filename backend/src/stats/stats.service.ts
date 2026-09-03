import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Account } from '../db/entities/account.entity';
import { AccountSnapshot } from '../db/entities/account-snapshot.entity';
import { Post, PostType } from '../db/entities/post.entity';

interface Period {
  from: string;
  to: string;
}

/**
 * Builds the inclusive upper bound for a date-only `to` string when querying a
 * timestamptz column (e.g. `publishedAt`). `new Date('2026-08-13')` parses to
 * midnight UTC, which would exclude every post published later that day —
 * this returns the last instant of that day instead.
 */
function endOfDayUtc(dateOnly: string): Date {
  return new Date(`${dateOnly}T23:59:59.999Z`);
}

@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(Account) private accountsRepo: Repository<Account>,
    @InjectRepository(AccountSnapshot) private snapshotsRepo: Repository<AccountSnapshot>,
    @InjectRepository(Post) private postsRepo: Repository<Post>,
  ) {}

  async getAccountDetail(accountId: string, period: Period) {
    const account = await this.accountsRepo.findOneBy({ id: accountId });
    const trend = await this.snapshotsRepo.find({
      where: { accountId, date: Between(period.from, period.to) },
      order: { date: 'ASC' },
    });
    const posts = await this.postsRepo.find({
      where: { accountId, publishedAt: Between(new Date(period.from), endOfDayUtc(period.to)) },
      order: { publishedAt: 'DESC' },
    });

    return {
      account,
      latestSnapshot: trend.length > 0 ? trend[trend.length - 1] : null,
      trend,
      posts,
    };
  }

  async getTopPosts(accountId: string, filter: Period & { type?: PostType }, limit: number) {
    const where: any = { accountId, publishedAt: Between(new Date(filter.from), endOfDayUtc(filter.to)) };
    if (filter.type) where.type = filter.type;

    const posts = await this.postsRepo.find({ where });
    return posts
      .sort((a, b) => b.likes + b.comments + b.shares - (a.likes + a.comments + a.shares))
      .slice(0, limit);
  }

  async getOverview() {
    const accounts = await this.accountsRepo.find({ where: { isActive: true } });
    const result: { account: Account; latestSnapshot: AccountSnapshot | null }[] = [];
    for (const account of accounts) {
      const latestSnapshot = await this.snapshotsRepo.findOne({
        where: { accountId: account.id },
        order: { date: 'DESC' },
      });
      result.push({ account, latestSnapshot });
    }
    return result;
  }

  async compare(accountIds: string[], period: Period) {
    const result: { account: Account | null; trend: AccountSnapshot[] }[] = [];
    for (const accountId of accountIds) {
      const account = await this.accountsRepo.findOneBy({ id: accountId });
      const trend = await this.snapshotsRepo.find({
        where: { accountId, date: Between(period.from, period.to) },
        order: { date: 'ASC' },
      });
      result.push({ account, trend });
    }
    return result;
  }
}
