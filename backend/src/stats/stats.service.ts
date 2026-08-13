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
      where: { accountId, publishedAt: Between(new Date(period.from), new Date(period.to)) },
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
    const where: any = { accountId, publishedAt: Between(new Date(filter.from), new Date(filter.to)) };
    if (filter.type) where.type = filter.type;

    const posts = await this.postsRepo.find({ where });
    return posts
      .sort((a, b) => b.likes + b.comments + b.shares - (a.likes + a.comments + a.shares))
      .slice(0, limit);
  }
}
