import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Account, AccountPlatform } from '../db/entities/account.entity';
import { CompetitorSuggestion } from '../db/entities/competitor-suggestion.entity';
import { CompetitorRunService } from './competitor-run.service';

@Injectable()
export class CompetitorsService {
  constructor(
    private runs: CompetitorRunService,
    @InjectRepository(CompetitorSuggestion) private suggestionsRepo: Repository<CompetitorSuggestion>,
    @InjectRepository(Account) private accountsRepo: Repository<Account>,
  ) {}

  async getFor(accountId: string) {
    const run = await this.runs.findLatest(accountId);
    const suggestions = await this.suggestionsRepo.find({
      where: { accountId },
      order: { rank: 'ASC' },
    });

    // Computed, never stored: a suggestion added later must show as tracked
    // without rewriting rows. Suggestions hold bare handles while accounts hold
    // '@handle', so the '@' goes on for the lookup and comes back off for the map.
    const stored = suggestions.map((s) => `@${s.externalId}`);
    const tracked = stored.length
      ? await this.accountsRepo.find({
          where: { platform: AccountPlatform.TELEGRAM, externalId: In(stored) },
        })
      : [];
    const byHandle = new Map(
      tracked.map((account) => [account.externalId.replace(/^@/, ''), account.id]),
    );

    return {
      enabled: this.runs.isEnabled(),
      run: run
        ? {
            id: run.id,
            status: run.status,
            niche: run.niche,
            errorMessage: run.errorMessage,
            finishedAt: run.finishedAt,
          }
        : null,
      suggestions: suggestions.map((s) => ({
        externalId: s.externalId,
        name: s.name,
        followersCount: s.followersCount,
        reason: s.reason,
        fit: s.fit,
        rank: s.rank,
        alreadyTracked: byHandle.has(s.externalId),
        trackedAccountId: byHandle.get(s.externalId) ?? null,
      })),
    };
  }
}
