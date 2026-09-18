import { Injectable, Logger } from '@nestjs/common';
import { Account, AccountPlatform } from '../db/entities/account.entity';
import { ConnectorRegistry } from '../connectors/connector-registry.service';
import { SocialConnector } from '../connectors/connector.interface';
import { ChannelProfile, RankedCandidate } from './competitor-finder';
import { looksLikeSpam } from './spam-description';

/** A channel with no post in this long is abandoned, not a competitor. */
const INACTIVE_AFTER_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

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

      // Candidate handles are bare (see parse-finder-reply.ts), but the Telegram Bot
      // API and Account.externalId both expect a leading '@' — re-add it only for
      // this call; VerifiedCandidate.handle stays bare.
      const draft = { platform: AccountPlatform.TELEGRAM, externalId: `@${candidate.handle}` } as Account;
      try {
        const info = await connector.getAccountInfo(draft);
        if (looksLikeSpam(info.description)) {
          this.logger.debug(`Dropping @${candidate.handle}: description looks like a spam funnel`);
          continue;
        }
        const stats = await connector.getAccountStats(draft);
        if (await this.isInactive(connector, draft)) {
          this.logger.debug(`Dropping @${candidate.handle}: no posts in ${INACTIVE_AFTER_DAYS} days`);
          continue;
        }
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

  /**
   * Only a known, old last post counts as inactive. A channel that hides its
   * web preview, or a check that fails, is kept: unknown is not evidence.
   */
  private async isInactive(connector: SocialConnector, account: Account): Promise<boolean> {
    if (!connector.getLatestPostAt) return false;
    try {
      const latest = await connector.getLatestPostAt(account);
      return latest !== null && Date.now() - latest.getTime() > INACTIVE_AFTER_DAYS * DAY_MS;
    } catch (error) {
      this.logger.debug(`Activity unknown for ${account.externalId}: ${(error as Error).message}`);
      return false;
    }
  }
}
