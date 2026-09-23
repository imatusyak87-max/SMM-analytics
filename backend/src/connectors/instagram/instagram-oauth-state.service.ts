import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InstagramAccountKind, InstagramOauthState } from '../../db/entities/instagram-oauth-state.entity';

const STATE_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class InstagramOauthStateService {
  constructor(@InjectRepository(InstagramOauthState) private repo: Repository<InstagramOauthState>) {}

  async create(type: InstagramAccountKind): Promise<string> {
    const id = randomUUID();
    await this.repo.save({ id, type });
    return id;
  }

  /** Single-use: the row is deleted whether it was fresh, stale, or already consumed. */
  async consume(id: string): Promise<InstagramAccountKind | null> {
    const state = await this.repo.findOneBy({ id });
    if (!state) return null;
    await this.repo.delete({ id });

    const age = Date.now() - state.createdAt.getTime();
    return age <= STATE_TTL_MS ? state.type : null;
  }
}
