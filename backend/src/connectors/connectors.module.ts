import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConnectorRegistry, CONNECTORS } from './connector-registry.service';
import { TelegramApiClient } from './telegram/telegram-api.client';
import { TelegramConnector } from './telegram/telegram.connector';
import { TelegramPreviewClient } from './telegram/telegram-preview.client';
import { TelegramWebhookController } from './telegram/telegram-webhook.controller';
import { InstagramModule } from './instagram/instagram.module';
import { InstagramConnector } from './instagram/instagram.connector';
import { Account } from '../db/entities/account.entity';
import { Post } from '../db/entities/post.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Account, Post]), InstagramModule],
  controllers: [TelegramWebhookController],
  providers: [
    {
      provide: CONNECTORS,
      useFactory: (instagramConnector: InstagramConnector) => [
        new TelegramConnector(
          new TelegramApiClient(process.env.TELEGRAM_BOT_TOKEN as string),
          new TelegramPreviewClient(),
        ),
        instagramConnector,
      ],
      inject: [InstagramConnector],
    },
    ConnectorRegistry,
  ],
  exports: [ConnectorRegistry],
})
export class ConnectorsModule {}
