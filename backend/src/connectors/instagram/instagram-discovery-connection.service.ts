import { Repository } from 'typeorm';
import { InstagramDiscoveryConnection } from '../../db/entities/instagram-discovery-connection.entity';
import { InstagramDiscoveryUnavailableError } from './instagram-discovery.errors';
import { decryptToken, encryptToken } from './instagram-token-crypto';

const CONNECTION_ID = 1;

export class InstagramDiscoveryConnectionService {
  constructor(
    private repo: Repository<InstagramDiscoveryConnection>,
    private encryptionKey: string,
  ) {}

  async getCredentials(): Promise<{ igUserId: string; token: string }> {
    const row = await this.repo.findOneBy({ id: CONNECTION_ID });
    if (!row) throw new InstagramDiscoveryUnavailableError('not_connected');
    if (this.mustReconnect(row)) throw new InstagramDiscoveryUnavailableError('reconnect');
    return { igUserId: row.igUserId, token: decryptToken(row.encryptedToken, this.encryptionKey) };
  }

  async status(): Promise<{ connected: boolean; needsReconnect: boolean; username: string | null }> {
    const row = await this.repo.findOneBy({ id: CONNECTION_ID });
    if (!row) return { connected: false, needsReconnect: false, username: null };
    return { connected: true, needsReconnect: this.mustReconnect(row), username: row.igUsername };
  }

  async save(input: { igUserId: string; igUsername: string; token: string; expiresAt: Date | null }): Promise<void> {
    await this.repo.save({
      id: CONNECTION_ID,
      igUserId: input.igUserId,
      igUsername: input.igUsername,
      encryptedToken: encryptToken(input.token, this.encryptionKey),
      tokenExpiresAt: input.expiresAt,
      needsReconnect: false,
      connectedAt: new Date(),
    });
  }

  async markNeedsReconnect(): Promise<void> {
    await this.repo.update({ id: CONNECTION_ID }, { needsReconnect: true });
  }

  // An expired token is known to fail; asking for a reconnect up front beats a failed lookup.
  private mustReconnect(row: InstagramDiscoveryConnection): boolean {
    return row.needsReconnect || (row.tokenExpiresAt !== null && row.tokenExpiresAt.getTime() <= Date.now());
  }
}
