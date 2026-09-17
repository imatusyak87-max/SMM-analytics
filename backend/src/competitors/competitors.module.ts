import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../db/entities/account.entity';
import { Post } from '../db/entities/post.entity';
import { CompetitorRun } from '../db/entities/competitor-run.entity';
import { CompetitorSuggestion } from '../db/entities/competitor-suggestion.entity';
import { ConnectorsModule } from '../connectors/connectors.module';
import { COMPETITOR_FINDER } from './competitor-finder';
import { GeminiFinder } from './gemini.finder';
import { COMPETITOR_CONFIG, CompetitorConfig, CompetitorRunService } from './competitor-run.service';
import { CompetitorProfileService } from './competitor-profile.service';
import { CompetitorVerifier } from './competitor-verifier.service';
import { CompetitorsProcessor } from './competitors.processor';
import { CompetitorsController } from './competitors.controller';
import { CompetitorsService } from './competitors.service';

const GEMINI_MODEL = 'gemini-2.5-flash';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'competitors' }),
    TypeOrmModule.forFeature([Account, Post, CompetitorRun, CompetitorSuggestion]),
    ConnectorsModule,
  ],
  controllers: [CompetitorsController],
  providers: [
    {
      provide: COMPETITOR_CONFIG,
      useFactory: (): CompetitorConfig => ({
        provider: 'gemini',
        model: GEMINI_MODEL,
        // With no key the feature switches itself off; everything else keeps working.
        enabled: Boolean(process.env.GEMINI_API_KEY),
      }),
    },
    {
      provide: COMPETITOR_FINDER,
      useFactory: () => new GeminiFinder(process.env.GEMINI_API_KEY ?? '', GEMINI_MODEL),
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
