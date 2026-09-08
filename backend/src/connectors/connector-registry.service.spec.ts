import { ConnectorRegistry } from './connector-registry.service';
import { AccountPlatform } from '../db/entities/account.entity';
import { SocialConnector } from './connector.interface';

describe('ConnectorRegistry', () => {
  it('returns the connector registered for a platform', () => {
    const fakeConnector = { platform: AccountPlatform.TELEGRAM } as SocialConnector;
    const registry = new ConnectorRegistry([fakeConnector]);
    expect(registry.get(AccountPlatform.TELEGRAM)).toBe(fakeConnector);
  });

  it('throws for an unregistered platform', () => {
    const registry = new ConnectorRegistry([]);
    expect(() => registry.get(AccountPlatform.VK)).toThrow();
  });
});
