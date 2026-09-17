import { Injectable, Logger } from '@nestjs/common';
import { Account, AccountPlatform } from '../db/entities/account.entity';
import { ConnectorRegistry } from '../connectors/connector-registry.service';
import { ChannelProfile, RankedCandidate } from './competitor-finder';

export interface VerifiedCandidate {
  handle: string;
  name: string;
  followersCount: number;
  reason: string;
  fit: number;
}

/**
 * A model naming Telegram channels will name some that do not exist. Only
 * channels Telegram itself resolves are ever stored, and the follower count
 * kept is Telegram's, never the model's.
 */
@Injectable()
export class CompetitorVerifier {
  private readonly logger = new Logger(CompetitorVerifier.name);

  constructor(private registry: ConnectorRegistry) {}

  async verify(candidates: RankedCandidate[], profile: ChannelProfile): Promise<VerifiedCandidate[]> {
    const connector = this.registry.get(AccountPlatform.TELEGRAM);
    const verified: VerifiedCandidate[] = [];
    const seen = new Set<string>([profile.handle]);

    for (const candidate of candidates) {
      if (seen.has(candidate.handle)) continue;
      seen.add(candidate.handle);

      const draft = { platform: AccountPlatform.TELEGRAM, externalId: candidate.handle } as Account;
      try {
        const info = await connector.getAccountInfo(draft);
        const stats = await connector.getAccountStats(draft);
        verified.push({
          handle: candidate.handle,
          name: info.name,
          followersCount: stats.followersCount,
          reason: candidate.reason,
          fit: candidate.fit,
        });
      } catch (error) {
        this.logger.debug(`Dropping unverifiable candidate @${candidate.handle}: ${(error as Error).message}`);
      }
    }

    return verified;
  }
}
