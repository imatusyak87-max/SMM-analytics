import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConnectorRegistry, CONNECTORS } from './connector-registry.service';
import { TelegramApiClient } from './telegram/telegram-api.client';
import { TelegramConnector } from './telegram/telegram.connector';
import { TelegramWebhookController } from './telegram/telegram-webhook.controller';
import { Account } from '../db/entities/account.entity';
import { Post } from '../db/entities/post.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Account, Post])],
  controllers: [TelegramWebhookController],
  providers: [
    {
      provide: CONNECTORS,
      useFactory: () => [new TelegramConnector(new TelegramApiClient(process.env.TELEGRAM_BOT_TOKEN as string))],
    },
    ConnectorRegistry,
  ],
  exports: [ConnectorRegistry],
})
export class ConnectorsModule {}
