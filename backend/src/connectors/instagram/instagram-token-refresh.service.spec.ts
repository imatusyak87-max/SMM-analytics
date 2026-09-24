import { InstagramTokenRefreshService } from './instagram-token-refresh.service';
import { AccountPlatform } from '../../db/entities/account.entity';
import { encryptToken } from './instagram-token-crypto';

const DAY_MS = 24 * 60 * 60 * 1000;
const KEY = 'a'.repeat(64);

function makeDeps() {
  const accountsRepo = { find: jest.fn(), update: jest.fn() };
  const credentialsRepo = { find: jest.fn(), update: jest.fn() };
  const api = {
    refreshLongLivedToken: jest.fn(),
    getProfile: jest.fn().mockResolvedValue({ id: 'ig-1', username: 'user', name: 'Name', profilePictureUrl: 'https://cdn/p.jpg' }),
  };
  const service = new InstagramTokenRefreshService(accountsRepo as any, credentialsRepo as any, api as any, KEY);
  return { service, accountsRepo, credentialsRepo, api };
}

describe('InstagramTokenRefreshService.refreshExpiring', () => {
  it('refreshes a credential expiring within 7 days and stores the new token encrypted', async () => {
    const { service, accountsRepo, credentialsRepo, api } = makeDeps();
    accountsRepo.find.mockResolvedValue([{ id: 'acc-1', platform: AccountPlatform.INSTAGRAM }]);
    credentialsRepo.find.mockResolvedValue([
      { accountId: 'acc-1', encryptedToken: encryptToken('old-token', KEY), tokenExpiresAt: new Date(Date.now() + 3 * DAY_MS) },
    ]);
    api.refreshLongLivedToken.mockResolvedValue({ accessToken: 'the-refreshed-token', expiresInSeconds: 5184000 });

    await service.refreshExpiring();

    expect(api.refreshLongLivedToken).toHaveBeenCalledWith('old-token');
    const update = credentialsRepo.update.mock.calls[0];
    expect(update[0]).toEqual({ accountId: 'acc-1' });
    expect(update[1].encryptedToken).not.toContain('the-refreshed-token');
    expect(update[1].needsReconnect).toBe(false);
  });

  it('leaves alone a credential that is not close to expiring', async () => {
    const { service, accountsRepo, credentialsRepo, api } = makeDeps();
    accountsRepo.find.mockResolvedValue([{ id: 'acc-1', platform: AccountPlatform.INSTAGRAM }]);
    credentialsRepo.find.mockResolvedValue([]); // the repo query itself excludes it; nothing to refresh

    await service.refreshExpiring();

    expect(api.refreshLongLivedToken).not.toHaveBeenCalled();
    expect(credentialsRepo.update).not.toHaveBeenCalled();
  });

  it('sets needsReconnect when a refresh fails on an auth error', async () => {
    const { service, accountsRepo, credentialsRepo, api } = makeDeps();
    accountsRepo.find.mockResolvedValue([{ id: 'acc-1', platform: AccountPlatform.INSTAGRAM }]);
    credentialsRepo.find.mockResolvedValue([
      { accountId: 'acc-1', encryptedToken: encryptToken('old-token', KEY), tokenExpiresAt: new Date(Date.now() + DAY_MS) },
    ]);
    api.refreshLongLivedToken.mockRejectedValue({
      response: { status: 400, data: { error: { type: 'OAuthException', code: 190, message: 'Error validating access token' } } },
    });

    await service.refreshExpiring();

    expect(credentialsRepo.update).toHaveBeenCalledWith({ accountId: 'acc-1' }, { needsReconnect: true });
  });

  it('leaves needsReconnect alone when a refresh fails transiently', async () => {
    const { service, accountsRepo, credentialsRepo, api } = makeDeps();
    accountsRepo.find.mockResolvedValue([{ id: 'acc-1', platform: AccountPlatform.INSTAGRAM }]);
    credentialsRepo.find.mockResolvedValue([
      { accountId: 'acc-1', encryptedToken: encryptToken('old-token', KEY), tokenExpiresAt: new Date(Date.now() + DAY_MS) },
    ]);
    api.refreshLongLivedToken.mockRejectedValue({ message: 'ETIMEDOUT' });

    await service.refreshExpiring();

    expect(credentialsRepo.update).not.toHaveBeenCalled();
  });

  it('keeps refreshing the remaining accounts after one fails', async () => {
    const { service, accountsRepo, credentialsRepo, api } = makeDeps();
    accountsRepo.find.mockResolvedValue([
      { id: 'acc-1', platform: AccountPlatform.INSTAGRAM },
      { id: 'acc-2', platform: AccountPlatform.INSTAGRAM },
    ]);
    credentialsRepo.find.mockResolvedValue([
      { accountId: 'acc-1', encryptedToken: encryptToken('old-token', KEY), tokenExpiresAt: new Date(Date.now() + DAY_MS) },
      { accountId: 'acc-2', encryptedToken: encryptToken('old-token', KEY), tokenExpiresAt: new Date(Date.now() + DAY_MS) },
    ]);
    api.refreshLongLivedToken
      .mockRejectedValueOnce({ message: 'ETIMEDOUT' })
      .mockResolvedValueOnce({ accessToken: 'tok-2', expiresInSeconds: 5184000 });

    await service.refreshExpiring();

    expect(api.refreshLongLivedToken).toHaveBeenCalledTimes(2);
    expect(credentialsRepo.update).toHaveBeenCalledTimes(1);
    expect(credentialsRepo.update.mock.calls[0][0]).toEqual({ accountId: 'acc-2' });
  });
});

describe('InstagramTokenRefreshService.refreshProfiles', () => {
  it('updates name and avatar for every connected Instagram account', async () => {
    const { service, accountsRepo, credentialsRepo, api } = makeDeps();
    accountsRepo.find.mockResolvedValue([{ id: 'acc-1', platform: AccountPlatform.INSTAGRAM }]);
    credentialsRepo.find.mockResolvedValue([{ accountId: 'acc-1', encryptedToken: encryptToken('tok-1', KEY), needsReconnect: false }]);
    api.getProfile.mockResolvedValue({ id: 'ig-1', username: 'fallback', name: null, profilePictureUrl: 'https://cdn/fresh.jpg' });

    await service.refreshProfiles();

    expect(api.getProfile).toHaveBeenCalledWith('tok-1');
    expect(credentialsRepo.find).toHaveBeenCalledWith({ where: { needsReconnect: false } });
    expect(accountsRepo.update).toHaveBeenCalledWith({ id: 'acc-1' }, { name: 'fallback', avatarUrl: 'https://cdn/fresh.jpg' });
  });

  it('skips credentials that belong to no Instagram account', async () => {
    const { service, accountsRepo, credentialsRepo, api } = makeDeps();
    accountsRepo.find.mockResolvedValue([]);
    credentialsRepo.find.mockResolvedValue([{ accountId: 'acc-x', encryptedToken: encryptToken('tok', KEY), needsReconnect: false }]);

    await service.refreshProfiles();

    expect(api.getProfile).not.toHaveBeenCalled();
    expect(accountsRepo.update).not.toHaveBeenCalled();
  });

  it('flags needsReconnect on an auth error and keeps going', async () => {
    const { service, accountsRepo, credentialsRepo, api } = makeDeps();
    accountsRepo.find.mockResolvedValue([
      { id: 'acc-1', platform: AccountPlatform.INSTAGRAM },
      { id: 'acc-2', platform: AccountPlatform.INSTAGRAM },
    ]);
    credentialsRepo.find.mockResolvedValue([
      { accountId: 'acc-1', encryptedToken: encryptToken('tok-1', KEY), needsReconnect: false },
      { accountId: 'acc-2', encryptedToken: encryptToken('tok-2', KEY), needsReconnect: false },
    ]);
    api.getProfile
      .mockRejectedValueOnce({ response: { status: 400, data: { error: { type: 'OAuthException', code: 190 } } } })
      .mockResolvedValueOnce({ id: 'ig-2', username: 'two', name: 'Two', profilePictureUrl: null });

    await service.refreshProfiles();

    expect(credentialsRepo.update).toHaveBeenCalledWith({ accountId: 'acc-1' }, { needsReconnect: true });
    expect(accountsRepo.update).toHaveBeenCalledWith({ id: 'acc-2' }, { name: 'Two', avatarUrl: null });
  });

  it('leaves needsReconnect alone on a rate limit or network error and keeps going', async () => {
    const { service, accountsRepo, credentialsRepo, api } = makeDeps();
    accountsRepo.find.mockResolvedValue([
      { id: 'acc-1', platform: AccountPlatform.INSTAGRAM },
      { id: 'acc-2', platform: AccountPlatform.INSTAGRAM },
    ]);
    credentialsRepo.find.mockResolvedValue([
      { accountId: 'acc-1', encryptedToken: encryptToken('tok-1', KEY), needsReconnect: false },
      { accountId: 'acc-2', encryptedToken: encryptToken('tok-2', KEY), needsReconnect: false },
    ]);
    api.getProfile
      .mockRejectedValueOnce({ response: { status: 429, data: { error: { type: 'OAuthException', code: 4 } } } })
      .mockResolvedValueOnce({ id: 'ig-2', username: 'two', name: 'Two', profilePictureUrl: null });

    await service.refreshProfiles();

    expect(credentialsRepo.update).not.toHaveBeenCalled();
    expect(accountsRepo.update).toHaveBeenCalledTimes(1);
  });

  it('runs as part of the nightly cron, after the token refresh', async () => {
    const { service, accountsRepo, credentialsRepo } = makeDeps();
    accountsRepo.find.mockResolvedValue([]);
    credentialsRepo.find.mockResolvedValue([]);
    const refreshProfiles = jest.spyOn(service, 'refreshProfiles');

    await service.refreshExpiring();

    expect(refreshProfiles).toHaveBeenCalled();
  });
});
