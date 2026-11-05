import { InstagramLoginError, InstagramOauthService } from './instagram-oauth.service';
import { InstagramAccountKind } from '../../db/entities/instagram-oauth-state.entity';
import { Account, AccountPlatform, AccountType } from '../../db/entities/account.entity';
import { AccountCredential } from '../../db/entities/account-credential.entity';

function makeDeps() {
  const stateService = { create: jest.fn().mockResolvedValue('a-state-id'), consume: jest.fn() };
  const api = {
    exchangeCodeForToken: jest.fn(),
    exchangeForLongLivedToken: jest.fn(),
    getProfile: jest.fn(),
  };
  const accountsRepo = { findOneBy: jest.fn(), save: jest.fn((row) => ({ id: 'acc-new', ...row })), update: jest.fn() };
  const credentialsRepo = { findOneBy: jest.fn(), save: jest.fn(), update: jest.fn() };
  // Saves made inside the transaction land on the same repo mocks the tests assert on.
  const em = {
    save: jest.fn((target: unknown, row: any) => {
      if (target === AccountCredential) return Promise.resolve(credentialsRepo.save(row));
      throw new Error('unexpected save target');
    }),
    update: jest.fn(),
  };
  (accountsRepo as any).manager = { transaction: jest.fn((cb: (em: unknown) => unknown) => cb(em)) };
  const service = new InstagramOauthService(
    stateService as any,
    api as any,
    accountsRepo as any,
    credentialsRepo as any,
    'app-id',
    'a'.repeat(64),
  );
  return { service, stateService, api, accountsRepo, credentialsRepo, em };
}

const PUBLIC_ACCOUNT = { id: 'acc-1', platform: AccountPlatform.INSTAGRAM, externalId: '@coffee_lab', type: AccountType.PUBLIC_NO_ACCESS, name: 'Coffee', avatarUrl: null, profileId: 'p1' };
const OWN_ACCOUNT = { ...PUBLIC_ACCOUNT, externalId: '17841400000000000', type: AccountType.OWN };

function loginAs(api: any, username: string, id = '17841400000000000') {
  api.exchangeCodeForToken.mockResolvedValue({ accessToken: 'short', instagramUserId: id });
  api.exchangeForLongLivedToken.mockResolvedValue({ accessToken: 'long', expiresInSeconds: 5184000 });
  api.getProfile.mockResolvedValue({ id, username, name: 'Coffee Lab', profilePictureUrl: 'https://cdn/a.jpg', biography: null });
}

describe('InstagramOauthService.buildAuthorizeUrlForAccount', () => {
  it('creates a state tied to the account and embeds it in the URL', async () => {
    const { service, stateService } = makeDeps();
    const url = await service.buildAuthorizeUrlForAccount(PUBLIC_ACCOUNT as any);
    expect(stateService.create).toHaveBeenCalledWith(InstagramAccountKind.OWN, 'acc-1');
    expect(url).toContain('state=a-state-id');
  });

  it('refuses an account that is not on Instagram', async () => {
    const { service } = makeDeps();
    await expect(service.buildAuthorizeUrlForAccount({ ...PUBLIC_ACCOUNT, platform: AccountPlatform.TELEGRAM } as any))
      .rejects.toThrow('Полный доступ есть только для Instagram');
  });
});

describe('InstagramOauthService.completeLogin', () => {
  it('rejects a missing or expired state before calling Instagram at all', async () => {
    const { service, stateService, api } = makeDeps();
    stateService.consume.mockResolvedValue(null);
    await expect(service.completeLogin('c', 's')).rejects.toThrow('Ссылка для входа устарела, попробуйте подключить аккаунт заново');
    expect(api.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('refuses a state that is not tied to an account', async () => {
    const { service, stateService, api } = makeDeps();
    stateService.consume.mockResolvedValue({ type: InstagramAccountKind.OWN, accountId: null });
    await expect(service.completeLogin('c', 's')).rejects.toThrow('Ссылка для входа устарела');
    expect(api.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('refuses a state that was issued for the Facebook discovery login', async () => {
    const { service, stateService } = makeDeps();
    stateService.consume.mockResolvedValue({ type: InstagramAccountKind.DISCOVERY, accountId: 'acc-1' });
    await expect(service.completeLogin('c', 's')).rejects.toThrow('Ссылка для входа устарела');
  });

  it('treats a login for a deleted account as an account that no longer exists', async () => {
    const { service, stateService, accountsRepo } = makeDeps();
    stateService.consume.mockResolvedValue({ type: InstagramAccountKind.OWN, accountId: 'acc-1' });
    accountsRepo.findOneBy.mockResolvedValue(null);
    const error = await service.completeLogin('code', 'state').catch((e) => e);
    expect(accountsRepo.findOneBy).toHaveBeenCalledWith({ id: 'acc-1', isActive: true });
    expect(error).toBeInstanceOf(InstagramLoginError);
    expect(error).toMatchObject({ message: 'Аккаунт больше не существует', accountId: null });
  });

  it('reports an expired login link without an account', async () => {
    const { service, stateService } = makeDeps();
    stateService.consume.mockResolvedValue(null);
    await expect(service.completeLogin('code', 'state')).rejects.toMatchObject({ accountId: null });
  });

  it('reports a cancelled login against the account without calling Instagram', async () => {
    const { service, stateService, api, accountsRepo } = makeDeps();
    stateService.consume.mockResolvedValue({ type: InstagramAccountKind.OWN, accountId: 'acc-1' });
    accountsRepo.findOneBy.mockResolvedValue(PUBLIC_ACCOUNT);

    await expect(service.completeLogin(undefined, 's')).rejects.toMatchObject({
      accountId: 'acc-1',
      message: 'Вход в Instagram отменён',
    });
    expect(api.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('omits the handle in a mismatch message when Instagram gave no username', async () => {
    const { service, stateService, api, accountsRepo } = makeDeps();
    stateService.consume.mockResolvedValue({ type: InstagramAccountKind.OWN, accountId: 'acc-1' });
    accountsRepo.findOneBy.mockResolvedValue(OWN_ACCOUNT);
    loginAs(api, undefined as any, '999');

    await expect(service.completeLogin('c', 's')).rejects.toMatchObject({
      message: 'Вы вошли в другой аккаунт Instagram',
    });
  });

  it('upgrades a public account to full access when the same username logs in', async () => {
    const { service, stateService, api, accountsRepo, credentialsRepo, em } = makeDeps();
    stateService.consume.mockResolvedValue({ type: InstagramAccountKind.OWN, accountId: 'acc-1' });
    accountsRepo.findOneBy.mockImplementation(({ id }: any) => Promise.resolve(id === 'acc-1' ? PUBLIC_ACCOUNT : null));
    loginAs(api, 'Coffee_Lab');

    const account = await service.completeLogin('c', 's');

    expect(em.update).toHaveBeenCalledWith(Account, { id: 'acc-1' }, {
      type: AccountType.OWN, externalId: '17841400000000000', name: 'Coffee Lab', avatarUrl: 'https://cdn/a.jpg',
    });
    expect(credentialsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'acc-1', needsReconnect: false }));
    expect(credentialsRepo.save.mock.calls[0][0].encryptedToken).not.toContain('long');
    expect(account).toMatchObject({ id: 'acc-1', type: AccountType.OWN });
  });

  it('refuses a different Instagram account and changes nothing', async () => {
    const { service, stateService, api, accountsRepo, credentialsRepo, em } = makeDeps();
    stateService.consume.mockResolvedValue({ type: InstagramAccountKind.OWN, accountId: 'acc-1' });
    accountsRepo.findOneBy.mockResolvedValue(PUBLIC_ACCOUNT);
    loginAs(api, 'someone_else');

    await expect(service.completeLogin('c', 's')).rejects.toMatchObject({
      accountId: 'acc-1',
      message: 'Вы вошли в другой аккаунт Instagram (@someone_else), а проект ждёт @coffee_lab',
    });
    expect(em.update).not.toHaveBeenCalled();
    expect(credentialsRepo.save).not.toHaveBeenCalled();
  });

  it('refuses the upgrade when that Instagram id is already a separate account', async () => {
    const { service, stateService, api, accountsRepo, em } = makeDeps();
    stateService.consume.mockResolvedValue({ type: InstagramAccountKind.OWN, accountId: 'acc-1' });
    accountsRepo.findOneBy.mockImplementation(({ id, externalId }: any) =>
      Promise.resolve(id === 'acc-1' ? PUBLIC_ACCOUNT : externalId === '17841400000000000' ? { id: 'acc-9' } : null));
    loginAs(api, 'coffee_lab');

    await expect(service.completeLogin('c', 's')).rejects.toMatchObject({
      accountId: 'acc-1',
      message: 'Этот аккаунт Instagram уже подключён отдельно — удалите дубликат и попробуйте снова',
    });
    expect(em.update).not.toHaveBeenCalled();
  });

  it('reports a database failure during the save against the account', async () => {
    const { service, stateService, api, accountsRepo } = makeDeps();
    stateService.consume.mockResolvedValue({ type: InstagramAccountKind.OWN, accountId: 'acc-1' });
    accountsRepo.findOneBy.mockResolvedValue(OWN_ACCOUNT);
    (accountsRepo as any).manager.transaction.mockRejectedValue(new Error('db down'));
    loginAs(api, 'coffee_lab');

    await expect(service.completeLogin('c', 's')).rejects.toMatchObject({
      accountId: 'acc-1', message: 'Не удалось подключить Instagram, попробуйте ещё раз',
    });
  });

  it('reconnects an own account when the same Instagram id logs in', async () => {
    const { service, stateService, api, accountsRepo, credentialsRepo, em } = makeDeps();
    stateService.consume.mockResolvedValue({ type: InstagramAccountKind.OWN, accountId: 'acc-1' });
    accountsRepo.findOneBy.mockResolvedValue(OWN_ACCOUNT);
    loginAs(api, 'coffee_lab');

    await service.completeLogin('c', 's');

    expect(em.update).toHaveBeenCalledWith(Account, { id: 'acc-1' }, expect.objectContaining({ type: AccountType.OWN }));
    expect(credentialsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'acc-1', needsReconnect: false }));
  });

  it('refuses a reconnect from a different Instagram id', async () => {
    const { service, stateService, api, accountsRepo } = makeDeps();
    stateService.consume.mockResolvedValue({ type: InstagramAccountKind.OWN, accountId: 'acc-1' });
    accountsRepo.findOneBy.mockResolvedValue(OWN_ACCOUNT);
    loginAs(api, 'other', '999');

    await expect(service.completeLogin('c', 's')).rejects.toMatchObject({
      accountId: 'acc-1', message: 'Вы вошли в другой аккаунт Instagram (@other)',
    });
  });

  it('reports a failed Instagram call against the account, in Russian', async () => {
    const { service, stateService, api, accountsRepo } = makeDeps();
    stateService.consume.mockResolvedValue({ type: InstagramAccountKind.OWN, accountId: 'acc-1' });
    accountsRepo.findOneBy.mockResolvedValue(PUBLIC_ACCOUNT);
    api.exchangeCodeForToken.mockRejectedValue({ response: { status: 400, data: { error_message: 'bad code' } } });

    const error = await service.completeLogin('c', 's').catch((e) => e);
    expect(error).toMatchObject({ accountId: 'acc-1' });
    expect(error.message).toMatch(/[А-Яа-я]/);
  });
});
