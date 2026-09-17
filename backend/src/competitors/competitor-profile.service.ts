import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '../db/entities/account.entity';
import { Post } from '../db/entities/post.entity';
import { ConnectorRegistry } from '../connectors/connector-registry.service';
import { ChannelProfile } from './competitor-finder';

const CAPTION_COUNT = 30;

@Injectable()
export class CompetitorProfileService {
  constructor(
    private registry: ConnectorRegistry,
    @InjectRepository(Post) private postsRepo: Repository<Post>,
  ) {}

  async build(account: Account): Promise<ChannelProfile> {
    const connector = this.registry.get(account.platform);
    const info = await connector.getAccountInfo(account);

    // A rate-limited stats call must not sink the whole run: size only weights
    // the ranking, while the title and description carry the topic.
    let followersCount = 0;
    try {
      followersCount = (await connector.getAccountStats(account)).followersCount;
    } catch {
      followersCount = 0;
    }

    const posts = await this.postsRepo.find({
      where: { accountId: account.id },
      order: { publishedAt: 'DESC' },
      take: CAPTION_COUNT,
    });

    return {
      handle: account.externalId,
      title: info.name ?? account.name,
      followersCount,
      description: info.description ?? null,
      captions: posts.map((post) => post.caption).filter((c): c is string => typeof c === 'string' && c.trim() !== ''),
    };
  }
}
