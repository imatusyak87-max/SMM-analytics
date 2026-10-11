import { InstagramDiscoveryConnectionService } from './instagram-discovery-connection.service';
import { InstagramDiscoveryUnavailableError } from './instagram-discovery.errors';
import { decryptToken, encryptToken } from './instagram-token-crypto';

const KEY = 'a'.repeat(64);
const DAY_MS = 24 * 60 * 60 * 1000;

function row(overrides: object = {}) {
  return {
    id: 1,
    igUserId: '1784',
    igUsername: 'fdagency',
    encryptedToken: encryptToken('fb-token', KEY),
    tokenExpiresAt: new Date(Date.now() + 30 * DAY_MS),
    needsReconnect: false,
    connectedAt: new Date(),
    ...overrides,
  };
}

function makeRepo(existing: object | null) {
  return { findOneBy: jest.fn().mockResolvedValue(existing), save: jest.fn(), update: jest.fn() } as any;
}

describe('InstagramDiscoveryConnectionService', () => {
  it('returns the decrypted token and the id lookups are made as', async () => {
    const service = new InstagramDiscoveryConnectionService(makeRepo(row()), KEY);

    expect(await service.getCredentials()).toEqual({ igUserId: '1784', token: 'fb-token' });
  });

  it.each([
    ['no connection exists', null, 'not_connected'],
    ['the connection was flagged', row({ needsReconnect: true }), 'reconnect'],
    ['the token has expired', row({ tokenExpiresAt: new Date(Date.now() - 1000) }), 'reconnect'],
  ])('refuses when %s', async (_label, existing, reason) => {
    const service = new InstagramDiscoveryConnectionService(makeRepo(existing), KEY);

    const attempt = service.getCredentials();

    await expect(attempt).rejects.toBeInstanceOf(InstagramDiscoveryUnavailableError);
    await expect(service.getCredentials()).rejects.toMatchObject({ reason });
  });

  it('treats a token without an expiry as valid', async () => {
    const service = new InstagramDiscoveryConnectionService(makeRepo(row({ tokenExpiresAt: null })), KEY);

    expect((await service.getCredentials()).token).toBe('fb-token');
  });

  it('reports status without exposing the token', async () => {
    expect(await new InstagramDiscoveryConnectionService(makeRepo(null), KEY).status()).toEqual({
      connected: false, needsReconnect: false, username: null,
    });
    expect(await new InstagramDiscoveryConnectionService(makeRepo(row({ needsReconnect: true })), KEY).status()).toEqual({
      connected: true, needsReconnect: true, username: 'fdagency',
    });
  });

  it('saves the single row encrypted and clears the reconnect flag', async () => {
    const repo = makeRepo(null);
    const expiresAt = new Date('2026-12-01T00:00:00Z');

    await new InstagramDiscoveryConnectionService(repo, KEY).save({ igUserId: '1784', igUsername: 'fdagency', token: 'fb-token', expiresAt });

    const saved = repo.save.mock.calls[0][0];
    expect(saved).toMatchObject({ id: 1, igUserId: '1784', igUsername: 'fdagency', tokenExpiresAt: expiresAt, needsReconnect: false });
    expect(saved.encryptedToken).not.toContain('fb-token');
    expect(decryptToken(saved.encryptedToken, KEY)).toBe('fb-token');
    expect(saved.connectedAt).toBeInstanceOf(Date);
  });

  it('flags the connection for reconnect', async () => {
    const repo = makeRepo(row());

    await new InstagramDiscoveryConnectionService(repo, KEY).markNeedsReconnect();

    expect(repo.update).toHaveBeenCalledWith({ id: 1 }, { needsReconnect: true });
  });
});
