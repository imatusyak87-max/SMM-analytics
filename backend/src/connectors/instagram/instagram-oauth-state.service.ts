import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { InstagramAccountKind, InstagramOauthState } from '../../db/entities/instagram-oauth-state.entity';

const STATE_TTL_MS = 10 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class InstagramOauthStateService {
  constructor(@InjectRepository(InstagramOauthState) private repo: Repository<InstagramOauthState>) {}

  async create(type: InstagramAccountKind): Promise<string> {
    const id = randomUUID();
    await this.repo.save({ id, type });
    return id;
  }

  /**
   * Single-use: the row is deleted whether it was fresh or stale. The id is
   * validated before any query: TypeORM silently drops an `undefined` where
   * value (a missing state would match ANY row), and a non-UUID would surface
   * a raw Postgres error. The delete-returning is one statement, so two
   * parallel callbacks with the same state cannot both succeed.
   */
  async consume(id: string): Promise<InstagramAccountKind | null> {
    if (typeof id !== 'string' || !UUID_PATTERN.test(id)) return null;

    const result = await this.repo
      .createQueryBuilder()
      .delete()
      .from(InstagramOauthState)
      .where('id = :id', { id })
      .returning(['type', 'createdAt'])
      .execute();
    const row = (result.raw as Array<{ type: InstagramAccountKind; createdAt: Date | string }> | undefined)?.[0];
    if (!row) return null;

    const age = Date.now() - new Date(row.createdAt).getTime();
    return age <= STATE_TTL_MS ? row.type : null;
  }

  /** Removes states whose login was abandoned (never reached the callback). */
  async purgeExpired(): Promise<void> {
    await this.repo.delete({ createdAt: LessThan(new Date(Date.now() - STATE_TTL_MS)) });
  }
}
