import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../db/entities/account.entity';
import { Post } from '../db/entities/post.entity';
import { CompetitorRun } from '../db/entities/competitor-run.entity';
import { CompetitorSuggestion } from '../db/entities/competitor-suggestion.entity';
import { CompetitorRejection } from '../db/entities/competitor-rejection.entity';
import { ConnectorsModule } from '../connectors/connectors.module';
import { COMPETITOR_FINDER } from './competitor-finder';
import { GeminiFinder } from './gemini.finder';
import { COMPETITOR_CONFIG, CompetitorConfig, CompetitorRunService } from './competitor-run.service';
import { CompetitorProfileService } from './competitor-profile.service';
import { CompetitorVerifier } from './competitor-verifier.service';
import { CompetitorsProcessor } from './competitors.processor';
import { CompetitorsController } from './competitors.controller';
import { CompetitorsService } from './competitors.service';

// 2.5 models are closed to new Google projects; see gemini.finder.ts.
const GEMINI_MODEL = 'gemini-3.6-flash';

/**
 * The only implemented provider today. COMPETITOR_LLM exists so an operator can
 * name a provider explicitly; anything other than "gemini" (including "claude",
 * which has no adapter yet) must fail loudly at boot rather than silently keep
 * running Gemini — that silent fallback is the bug this guards against.
 */
function assertSupportedProvider(provider: string): void {
  if (provider !== 'gemini') {
    throw new Error(
      `Unsupported COMPETITOR_LLM provider "${provider}": only "gemini" is implemented. ` +
        'Add an adapter for this provider before setting COMPETITOR_LLM to it.',
    );
  }
}

export function resolveCompetitorConfig(env: NodeJS.ProcessEnv): CompetitorConfig {
  const provider = env.COMPETITOR_LLM ?? 'gemini';
  assertSupportedProvider(provider);
  return {
    provider,
    model: GEMINI_MODEL,
    // With no key the feature switches itself off; everything else keeps working.
    enabled: Boolean(env.GEMINI_API_KEY),
  };
}

export function resolveCompetitorFinder(env: NodeJS.ProcessEnv) {
  const provider = env.COMPETITOR_LLM ?? 'gemini';
  assertSupportedProvider(provider);
  return new GeminiFinder(env.GEMINI_API_KEY ?? '', GEMINI_MODEL);
}

@Module({
  imports: [
    BullModule.registerQueue({ name: 'competitors' }),
    TypeOrmModule.forFeature([Account, Post, CompetitorRun, CompetitorSuggestion, CompetitorRejection]),
    ConnectorsModule,
  ],
  controllers: [CompetitorsController],
  providers: [
    {
      provide: COMPETITOR_CONFIG,
      useFactory: (): CompetitorConfig => resolveCompetitorConfig(process.env),
    },
    {
      provide: COMPETITOR_FINDER,
      useFactory: () => resolveCompetitorFinder(process.env),
    },
    CompetitorRunService,
    CompetitorProfileService,
    CompetitorVerifier,
    CompetitorsProcessor,
    CompetitorsService,
  ],
  exports: [CompetitorRunService],
})
export class CompetitorsModule {}
