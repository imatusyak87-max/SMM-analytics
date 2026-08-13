import { Injectable, Inject } from '@nestjs/common';
import { AccountPlatform } from '../db/entities/account.entity';
import { SocialConnector } from './connector.interface';

export const CONNECTORS = 'CONNECTORS';

@Injectable()
export class ConnectorRegistry {
  private byPlatform = new Map<AccountPlatform, SocialConnector>();

  constructor(@Inject(CONNECTORS) connectors: SocialConnector[]) {
    for (const connector of connectors) {
      this.byPlatform.set(connector.platform, connector);
    }
  }

  get(platform: AccountPlatform): SocialConnector {
    const connector = this.byPlatform.get(platform);
    if (!connector) throw new Error(`No connector registered for platform ${platform}`);
    return connector;
  }
}
