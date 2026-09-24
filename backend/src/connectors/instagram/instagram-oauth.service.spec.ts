import { InstagramOauthService } from './instagram-oauth.service';
import { InstagramAccountKind } from '../../db/entities/instagram-oauth-state.entity';
import { AccountPlatform, AccountType } from '../../db/entities/account.entity';

function makeDeps() {
  const stateService = { create: jest.fn().mockResolvedValue('a-state-id'), consume: jest.fn() };
  const api = {
    exchangeCodeForToken: jest.fn(),
    exchangeForLongLivedToken: jest.fn(),
    getProfile: jest.fn(),
  };
  const accountsRepo = { findOneBy: jest.fn(), save: jest.fn((row) => ({ id: 'acc-new', ...row })), update: jest.fn() };
  const credentialsRepo = { findOneBy: jest.fn(), save: jest.fn(), update: jest.fn() };
  const service = new InstagramOauthService(
    stateService as any,
    api as any,
    accountsRepo as any,
    credentialsRepo as any,
    'app-id',
    'a'.repeat(64),
  );
  return { service, stateService, api, accountsRepo, credentialsRepo };
}

describe('InstagramOauthService.buildAuthorizeUrl', () => {
  it('creates a state for the given type and embeds it in the URL', async () => {
    const { service, stateService } = makeDeps();

    const url = await service.buildAuthorizeUrl(InstagramAccountKind.OWN);

    expect(stateService.create).toHaveBeenCalledWith(InstagramAccountKind.OWN);
    expect(url).toContain('state=a-state-id');
    expect(url).toContain('client_id=app-id');
  });
});

describe('InstagramOauthService.completeLogin', () => {
  it('rejects a missing or expired state before calling Instagram at all', async () => {
    const { service, stateService, api } = makeDeps();
    stateService.consume.mockResolvedValue(null);

    await expect(service.completeLogin('a-code', 'bad-state')).rejects.toThrow(
      'Ссылка для входа устарела, попробуйте подключить аккаунт заново',
    );
    expect(api.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('creates a new account and credential when the Instagram id is not tracked yet', async () => {
    const { service, stateService, api, accountsRepo, credentialsRepo } = makeDeps();
    stateService.consume.mockResolvedValue(InstagramAccountKind.CLIENT);
    api.exchangeCodeForToken.mockResolvedValue({ accessToken: 'short-tok', instagramUserId: '17841400000000000' });
    api.exchangeForLongLivedToken.mockResolvedValue({ accessToken: 'long-tok', expiresInSeconds: 5184000 });
    api.getProfile.mockResolvedValue({ id: '17841400000000000', username: 'client_account', name: 'Client', profilePictureUrl: null, biography: null });
    accountsRepo.findOneBy.mockResolvedValue(null);

    const account = await service.completeLogin('a-code', 'good-state');

    expect(accountsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ platform: AccountPlatform.INSTAGRAM, externalId: '17841400000000000', type: AccountType.CLIENT }),
    );
    expect(credentialsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc-new', needsReconnect: false }),
    );
    expect(account.id).toBe('acc-new');
  });

  it('writes (upserts) the credential, and clears needsReconnect, when the Instagram id is already tracked', async () => {
    const { service, stateService, api, accountsRepo, credentialsRepo } = makeDeps();
    stateService.consume.mockResolvedValue(InstagramAccountKind.OWN);
    api.exchangeCodeForToken.mockResolvedValue({ accessToken: 'short-tok', instagramUserId: '17841400000000000' });
    api.exchangeForLongLivedToken.mockResolvedValue({ accessToken: 'long-tok', expiresInSeconds: 5184000 });
    api.getProfile.mockResolvedValue({ id: '17841400000000000', username: 'agency_own', name: null, profilePictureUrl: null, biography: null });
    accountsRepo.findOneBy.mockResolvedValue({ id: 'acc-existing', platform: AccountPlatform.INSTAGRAM, externalId: '17841400000000000' });

    const account = await service.completeLogin('a-code', 'good-state');

    expect(account.id).toBe('acc-existing');
    expect(accountsRepo.save).not.toHaveBeenCalled();
    // save() keyed by the accountId primary key inserts the row when the
    // data-deletion webhook removed it, and updates it otherwise; update()
    // would silently touch 0 rows after a deletion.
    expect(credentialsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc-existing', needsReconnect: false, encryptedToken: expect.any(String) }),
    );
    expect(credentialsRepo.update).not.toHaveBeenCalled();
  });

  it('refreshes the name and avatar of an already tracked account from the fetched profile', async () => {
    const { service, stateService, api, accountsRepo } = makeDeps();
    stateService.consume.mockResolvedValue(InstagramAccountKind.OWN);
    api.exchangeCodeForToken.mockResolvedValue({ accessToken: 'short-tok', instagramUserId: '17841400000000000' });
    api.exchangeForLongLivedToken.mockResolvedValue({ accessToken: 'long-tok', expiresInSeconds: 5184000 });
    api.getProfile.mockResolvedValue({ id: '17841400000000000', username: 'renamed', name: 'New Name', profilePictureUrl: 'https://cdn/new.jpg', biography: null });
    accountsRepo.findOneBy.mockResolvedValue({ id: 'acc-existing', name: 'Old Name', avatarUrl: 'https://cdn/expired.jpg' });

    const account = await service.completeLogin('a-code', 'good-state');

    expect(accountsRepo.update).toHaveBeenCalledWith({ id: 'acc-existing' }, { name: 'New Name', avatarUrl: 'https://cdn/new.jpg' });
    expect(account).toMatchObject({ id: 'acc-existing', name: 'New Name', avatarUrl: 'https://cdn/new.jpg' });
  });

  it('keys the account by the /me profile id, not the token response user_id', async () => {
    const { service, stateService, api, accountsRepo } = makeDeps();
    stateService.consume.mockResolvedValue(InstagramAccountKind.OWN);
    // A numeric user_id past 2^53 loses precision in JSON.parse; /me returns the id as a string.
    api.exchangeCodeForToken.mockResolvedValue({ accessToken: 'short-tok', instagramUserId: '17841400000000000' });
    api.exchangeForLongLivedToken.mockResolvedValue({ accessToken: 'long-tok', expiresInSeconds: 5184000 });
    api.getProfile.mockResolvedValue({ id: '17841400000000001', username: 'agency_own', name: null, profilePictureUrl: null, biography: null });
    accountsRepo.findOneBy.mockResolvedValue(null);

    await service.completeLogin('a-code', 'good-state');

    expect(accountsRepo.findOneBy).toHaveBeenCalledWith({ platform: AccountPlatform.INSTAGRAM, externalId: '17841400000000001' });
    expect(accountsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ externalId: '17841400000000001' }));
  });

  it('stores the token encrypted, never the plaintext', async () => {
    const { service, stateService, api, accountsRepo, credentialsRepo } = makeDeps();
    stateService.consume.mockResolvedValue(InstagramAccountKind.OWN);
    api.exchangeCodeForToken.mockResolvedValue({ accessToken: 'short-tok', instagramUserId: '17841400000000000' });
    api.exchangeForLongLivedToken.mockResolvedValue({ accessToken: 'the-real-long-lived-token', expiresInSeconds: 5184000 });
    api.getProfile.mockResolvedValue({ id: '17841400000000000', username: 'agency_own', name: null, profilePictureUrl: null, biography: null });
    accountsRepo.findOneBy.mockResolvedValue(null);

    await service.completeLogin('a-code', 'good-state');

    const saved = credentialsRepo.save.mock.calls[0][0];
    expect(saved.encryptedToken).not.toContain('the-real-long-lived-token');
  });

  it('translates a failed Instagram call into a Russian message', async () => {
    const { service, stateService, api } = makeDeps();
    stateService.consume.mockResolvedValue(InstagramAccountKind.OWN);
    api.exchangeCodeForToken.mockRejectedValue({
      response: { status: 400, data: { error: { type: 'OAuthException', code: 190, message: 'Error validating access token' } } },
    });

    await expect(service.completeLogin('a-code', 'good-state')).rejects.toThrow(
      'Instagram отклонил доступ, нужно переподключить аккаунт',
    );
  });
});
