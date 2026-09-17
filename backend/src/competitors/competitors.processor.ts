import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { Account } from '../db/entities/account.entity';
import { CompetitorRun, CompetitorRunStatus } from '../db/entities/competitor-run.entity';
import { CompetitorSuggestion } from '../db/entities/competitor-suggestion.entity';
import { COMPETITOR_FINDER, type CompetitorFinder } from './competitor-finder';
import { CompetitorProfileService } from './competitor-profile.service';
import { CompetitorVerifier } from './competitor-verifier.service';
import { scoreCandidate } from './score';

interface CompetitorJobData {
  runId: string;
  accountId: string;
}

const KEEP = 10;

function isFinalAttempt(job: Job<CompetitorJobData>): boolean {
  const allowed = job.opts?.attempts ?? 1;
  return (job.attemptsMade ?? 0) + 1 >= allowed;
}

@Processor('competitors', { concurrency: 1 })
export class CompetitorsProcessor extends WorkerHost {
  private readonly logger = new Logger(CompetitorsProcessor.name);

  constructor(
    @InjectRepository(Account) private accountsRepo: Repository<Account>,
    @InjectRepository(CompetitorRun) private runsRepo: Repository<CompetitorRun>,
    @InjectRepository(CompetitorSuggestion) private suggestionsRepo: Repository<CompetitorSuggestion>,
    private profiles: CompetitorProfileService,
    @Inject(COMPETITOR_FINDER) private finder: CompetitorFinder,
    private verifier: CompetitorVerifier,
  ) {
    super();
  }

  async process(job: Job<CompetitorJobData>): Promise<void> {
    const { runId, accountId } = job.data;

    try {
      await this.runsRepo.update(runId, { status: CompetitorRunStatus.RUNNING, startedAt: new Date() });

      const account = await this.accountsRepo.findOneBy({ id: accountId });
      if (!account) throw new Error(`Account ${accountId} not found`);

      const profile = await this.profiles.build(account);
      const result = await this.finder.suggest(profile);
      const verified = await this.verifier.verify(result.candidates, profile);

      const ranked = verified
        .map((candidate) => ({
          ...candidate,
          score: scoreCandidate(candidate.fit, profile.followersCount, candidate.followersCount),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, KEEP);

      // Replaced only once a run has produced something: a failed run must leave
      // the previous list intact. Delete + save run in one transaction so a save
      // failure (pool exhaustion, constraint violation, ...) after a successful
      // delete cannot leave the account with zero suggestions.
      await this.suggestionsRepo.manager.transaction(async (em) => {
        await em.delete(CompetitorSuggestion, { accountId });
        if (ranked.length > 0) {
          await em.save(
            ranked.map((candidate, index) =>
              em.create(CompetitorSuggestion, {
                runId,
                accountId,
                externalId: candidate.handle,
                name: candidate.name,
                followersCount: candidate.followersCount,
                reason: candidate.reason,
                fit: candidate.fit,
                score: candidate.score,
                rank: index + 1,
              }),
            ),
          );
        }
      });

      await this.runsRepo.update(runId, {
        status: CompetitorRunStatus.SUCCESS,
        niche: result.niche,
        llmProvider: result.provider,
        llmModel: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd.toFixed(4),
        candidatesProposed: result.candidates.length,
        candidatesVerified: verified.length,
        finishedAt: new Date(),
      });
    } catch (error) {
      if (isFinalAttempt(job)) {
        try {
          await this.runsRepo.update(runId, {
            status: CompetitorRunStatus.FAILED,
            errorMessage: (error as Error).message,
            finishedAt: new Date(),
          });
        } catch (updateError) {
          this.logger.error(
            `Failed to record FAILED status for competitor run ${runId}: ${(error as Error).message}`,
            (updateError as Error).stack,
          );
        }
      }
      throw error;
    }
  }
}
