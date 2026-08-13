import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { HealthController } from './health/health.controller';
import { DbModule } from './db/db.module';
import { AuthModule } from './auth/auth.module';
import { AccountsModule } from './accounts/accounts.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule,
    AuthModule,
    AccountsModule,
    BullModule.forRoot({ connection: { url: process.env.REDIS_URL } }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
