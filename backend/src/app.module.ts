import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthController } from './health/health.controller';
import { DbModule } from './db/db.module';
import { AuthModule } from './auth/auth.module';
import { AccountsModule } from './accounts/accounts.module';
import { StatsModule } from './stats/stats.module';
import { SyncModule } from './sync/sync.module';
import { ConnectorsModule } from './connectors/connectors.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule,
    AuthModule,
    AccountsModule,
    StatsModule,
    SyncModule,
    ConnectorsModule,
    BullModule.forRoot({ connection: { url: process.env.REDIS_URL } }),
    ScheduleModule.forRoot(),
  ],
  controllers: [HealthController],
})
export class AppModule {}
