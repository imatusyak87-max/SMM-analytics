import { Module } from '@nestjs/common';
import { ConnectorRegistry, CONNECTORS } from './connector-registry.service';
import { TelegramApiClient } from './telegram/telegram-api.client';
import { TelegramConnector } from './telegram/telegram.connector';

@Module({
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
