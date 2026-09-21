import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Account, AccountPlatform } from '../db/entities/account.entity';
import { CompetitorSuggestion } from '../db/entities/competitor-suggestion.entity';
import { CompetitorRejection } from '../db/entities/competitor-rejection.entity';
import { CompetitorRunService } from './competitor-run.service';

@Injectable()
export class CompetitorsService {
  constructor(
    private runs: CompetitorRunService,
    @InjectRepository(CompetitorSuggestion) private suggestionsRepo: Repository<CompetitorSuggestion>,
    @InjectRepository(Account) private accountsRepo: Repository<Account>,
    @InjectRepository(CompetitorRejection) private rejectionsRepo: Repository<CompetitorRejection>,
  ) {}

  async getFor(accountId: string) {
    const run = await this.runs.findLatest(accountId);
    const [stored, rejections] = await Promise.all([
      this.suggestionsRepo.find({ where: { accountId }, order: { rank: 'ASC' } }),
      this.rejectionsRepo.find({ where: { accountId } }),
    ]);
    // Filtered on read rather than deleted, so undoing a rejection brings the
    // suggestion back exactly as it was.
    const rejected = new Set(rejections.map((r) => r.externalId));
    const suggestions = stored.filter((s) => !rejected.has(s.externalId));

    // Computed, never stored: a suggestion added later must show as tracked
    // without rewriting rows. Suggestions hold bare handles while accounts hold
    // '@handle', so the '@' goes on for the lookup and comes back off for the map.
    const handles = suggestions.map((s) => `@${s.externalId}`);
    const tracked = handles.length
      ? await this.accountsRepo.find({
          where: { platform: AccountPlatform.TELEGRAM, externalId: In(handles) },
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

  /** «Не конкурент»: hide a suggestion for this account, now and in future runs. */
  async reject(accountId: string, handle: string): Promise<void> {
    const externalId = await this.checkTarget(accountId, handle);
    // Upsert on the unique pair, so a double click or a retry is harmless.
    await this.rejectionsRepo.upsert({ accountId, externalId }, ['accountId', 'externalId']);
  }

  async unreject(accountId: string, handle: string): Promise<void> {
    const externalId = await this.checkTarget(accountId, handle);
    await this.rejectionsRepo.delete({ accountId, externalId });
  }

  private async checkTarget(accountId: string, handle: string): Promise<string> {
    const externalId = handle.toLowerCase();
    // Telegram usernames: 5-32 letters, digits and underscores; allow 4 for
    // older short names. Anything else never came from a suggestion.
    if (!/^[a-z0-9_]{4,32}$/.test(externalId)) {
      throw new BadRequestException('Некорректное имя канала');
    }
    const account = await this.accountsRepo.findOneBy({ id: accountId });
    if (!account) throw new NotFoundException(`Account ${accountId} not found`);
    return externalId;
  }
}
