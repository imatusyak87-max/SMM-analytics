import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Account } from '../db/entities/account.entity';
import { AccountSnapshot } from '../db/entities/account-snapshot.entity';
import { Post, PostType } from '../db/entities/post.entity';
import type { PostSortKey } from './dto/post-filter.dto';
import { POST_HISTORY_DAYS } from '../sync/history-window';

interface Period {
  from: string;
  to: string;
}

export interface AccountSummary {
  followersCount: number | null;
  postsCount: number;
  totalViews: number;
  totalReactions: number;
  avgViews: number;
  avgReactions: number;
  erViews: number | null;
  erFollowers: number | null;
}

export interface PostsPageQuery extends Period {
  type?: PostType;
  sort: PostSortKey;
  page: number;
  size: number;
}

export interface PostsPage {
  total: number;
  items: Post[];
}

/** The UI's sort names mapped to the columns they order by, in one place. */
const SORT_COLUMNS: Record<PostSortKey, string> = {
  views: 'post.views',
  reactions: 'post.likes',
  er: 'post.erViews',
  date: 'post.publishedAt',
};

const DAY_MS = 86_400_000;

export interface PostTotals {
  postsCount: number;
  totalViews: number;
  totalReactions: number;
}

/**
 * ER is weighted — totals over totals — because the mean of per-post ERs lets a
 * post with a dozen views dominate the channel's figure.
 */
export function summarise(totals: PostTotals, followersCount: number | null): AccountSummary {
  const { postsCount, totalViews, totalReactions } = totals;

  return {
    followersCount,
    postsCount,
    totalViews,
    totalReactions,
    avgViews: postsCount > 0 ? totalViews / postsCount : 0,
    avgReactions: postsCount > 0 ? totalReactions / postsCount : 0,
    erViews: totalViews > 0 ? (totalReactions / totalViews) * 100 : null,
    erFollowers:
      followersCount && followersCount > 0 && postsCount > 0
        ? (totalReactions / postsCount / followersCount) * 100
        : null,
  };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
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
    if (!account) throw new NotFoundException(`Account ${accountId} not found`);

    const trend = await this.snapshotsRepo.find({
      where: { accountId, date: Between(period.from, period.to) },
      order: { date: 'ASC' },
    });
    const firstSnapshot = await this.snapshotsRepo.findOne({
      where: { accountId },
      order: { date: 'ASC' },
    });
    const totals = await this.getPostTotals(accountId, period);

    const latestSnapshot = trend.length > 0 ? trend[trend.length - 1] : null;

    return {
      account,
      latestSnapshot,
      trend,
      summary: summarise(totals, latestSnapshot?.followersCount ?? null),
      coverage: {
        postsFrom: isoDate(new Date(account.createdAt.getTime() - POST_HISTORY_DAYS * DAY_MS)),
        followersFrom: firstSnapshot?.date ?? isoDate(account.createdAt),
      },
    };
  }

  /**
   * Counts and sums in SQL. The period's rows are no longer loaded for the browser,
   * so loading them only to add them up would fetch a whole period to return three
   * numbers.
   */
  private async getPostTotals(accountId: string, period: Period): Promise<PostTotals> {
    const raw = await this.postsRepo
      .createQueryBuilder('post')
      .select('COUNT(*)', 'postsCount')
      .addSelect('COALESCE(SUM(post.views), 0)', 'totalViews')
      .addSelect('COALESCE(SUM(post.likes), 0)', 'totalReactions')
      .where('post.accountId = :accountId', { accountId })
      .andWhere('post.publishedAt BETWEEN :from AND :to', {
        from: new Date(period.from),
        to: endOfDayUtc(period.to),
      })
      .getRawOne<{ postsCount: string; totalViews: string; totalReactions: string }>();

    // Postgres returns COUNT and SUM as bigint, which the driver hands back as strings.
    return {
      postsCount: Number(raw?.postsCount ?? 0),
      totalViews: Number(raw?.totalViews ?? 0),
      totalReactions: Number(raw?.totalReactions ?? 0),
    };
  }

  async getPostsPage(accountId: string, query: PostsPageQuery): Promise<PostsPage> {
    const qb = this.postsRepo
      .createQueryBuilder('post')
      .where('post.accountId = :accountId', { accountId })
      .andWhere('post.publishedAt BETWEEN :from AND :to', {
        from: new Date(query.from),
        to: endOfDayUtc(query.to),
      });
    if (query.type) qb.andWhere('post.type = :type', { type: query.type });

    const [items, total] = await qb
      .orderBy(SORT_COLUMNS[query.sort], 'DESC', 'NULLS LAST')
      .addOrderBy('post.publishedAt', 'DESC')
      .addOrderBy('post.id', 'ASC')
      .offset((query.page - 1) * query.size)
      .limit(query.size)
      .getManyAndCount();

    return { total, items };
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
