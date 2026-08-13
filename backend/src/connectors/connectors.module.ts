import { Module } from '@nestjs/common';
import { ConnectorRegistry, CONNECTORS } from './connector-registry.service';

@Module({
  providers: [
    { provide: CONNECTORS, useFactory: () => [] },
    ConnectorRegistry,
  ],
  exports: [ConnectorRegistry],
})
export class ConnectorsModule {}
