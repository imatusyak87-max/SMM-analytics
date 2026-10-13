import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Post } from '../db/entities/post.entity';
import { ConnectorPost, PostInsights } from '../connectors/connector.interface';
import { calculateEr, calculateErByViews } from '../sync/er-calculator';

const UPDATABLE_COLUMNS = [
  'type',
  'publishedAt',
  'permalink',
  'thumbnailUrl',
  'caption',
  'likes',
  'comments',
  'shares',
  'views',
  'reach',
  'er',
  'erViews',
  'lastSyncedAt',
];
/** Filled by the insights phase or the nightly sync; a history page must not blank them. */
const INSIGHT_COLUMNS = new Set(['reach', 'shares', 'views', 'er', 'erViews']);
const PRESERVING_COLUMNS = UPDATABLE_COLUMNS.filter((c) => !INSIGHT_COLUMNS.has(c));
// A competitor's Reel brings its public view count on the page itself, and no
// insights phase will fill it later — so views from the page are written.
const PRESERVING_WITH_VIEWS_COLUMNS = [...PRESERVING_COLUMNS, 'views', 'erViews'];

export function insightCursor(post: Pick<Post, 'publishedAt' | 'externalPostId'>): string {
  return `${post.publishedAt.toISOString()}|${post.externalPostId}`;
}

/** Every `posts` read and write the full-history job makes. */
@Injectable()
export class HistoryPostStore {
  constructor(@InjectRepository(Post) private postsRepo: Repository<Post>) {}

  async write(accountId: string, posts: ConnectorPost[], followersCount: number, preserveInsights: boolean): Promise<void> {
    if (posts.length === 0) return;
    // A single bulk INSERT...ON CONFLICT DO UPDATE fails in Postgres ("cannot affect
    // row a second time") if a page repeats an externalPostId; keep the last one.
    const deduped = [...new Map(posts.map((post) => [post.externalPostId, post])).values()];
    const now = new Date();
    const rows = deduped.map((post) => ({
      accountId,
      ...post,
      er: calculateEr(post.likes, post.comments, post.shares, followersCount),
      erViews: calculateErByViews(post.likes, post.views),
      lastSyncedAt: now,
    }));
    if (!preserveInsights) return this.upsert(rows, UPDATABLE_COLUMNS);
    const withViews = rows.filter((row) => row.views !== null);
    const withoutViews = rows.filter((row) => row.views === null);
    if (withViews.length > 0) await this.upsert(withViews, PRESERVING_WITH_VIEWS_COLUMNS);
    if (withoutViews.length > 0) await this.upsert(withoutViews, PRESERVING_COLUMNS);
  }

  private async upsert(rows: Partial<Post>[], update: string[]): Promise<void> {
    await this.postsRepo
      .createQueryBuilder()
      .insert()
      .into(Post)
      .values(rows)
      .orUpdate(update, ['accountId', 'externalPostId'])
      .execute();
  }

  async countInsightTargets(accountId: string, windowStart: Date): Promise<number> {
    return this.postsRepo
      .createQueryBuilder('p')
      .where('p.accountId = :accountId', { accountId })
      .andWhere('p.publishedAt < :windowStart', { windowStart })
      .getCount();
  }

  async nextInsightTargets(accountId: string, windowStart: Date, cursor: string | null, limit: number): Promise<Post[]> {
    const qb = this.postsRepo
      .createQueryBuilder('p')
      .where('p.accountId = :accountId', { accountId })
      .andWhere('p.publishedAt < :windowStart', { windowStart });
    if (cursor) {
      const split = cursor.indexOf('|');
      qb.andWhere(
        '(p.publishedAt < :cursorAt OR (p.publishedAt = :cursorAt AND p.externalPostId < :cursorId))',
        { cursorAt: new Date(cursor.slice(0, split)), cursorId: cursor.slice(split + 1) },
      );
    }
    return qb.orderBy('p.publishedAt', 'DESC').addOrderBy('p.externalPostId', 'DESC').limit(limit).getMany();
  }

  async saveInsights(post: Post, insights: PostInsights, followersCount: number): Promise<void> {
    // null means Instagram had nothing for this post; keep whatever is stored.
    const reach = insights.reach ?? post.reach;
    const shares = insights.shares ?? post.shares;
    const views = insights.views ?? post.views;
    await this.postsRepo.update(
      { id: post.id },
      {
        reach,
        shares,
        views,
        er: calculateEr(post.likes, post.comments, shares, followersCount),
        erViews: calculateErByViews(post.likes, views),
      },
    );
  }
}
