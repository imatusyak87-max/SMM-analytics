import { InstagramOauthController } from './instagram-oauth.controller';
import { AccountPlatform } from '../../db/entities/account.entity';

function makeController(overrides: Partial<Record<string, any>> = {}) {
  const oauthService = { completeLogin: jest.fn(), ...overrides.oauthService };
  const accountsRepo = { findOneBy: jest.fn(), ...overrides.accountsRepo };
  const credentialsRepo = { update: jest.fn(), delete: jest.fn(), ...overrides.credentialsRepo };
  const controller = new InstagramOauthController(oauthService, accountsRepo, credentialsRepo, 'app-secret');
  return { controller, oauthService, accountsRepo, credentialsRepo };
}

function fakeResponse() {
  return { redirect: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() } as any;
}

describe('InstagramOauthController.callback', () => {
  it('redirects to the new account on a successful login', async () => {
    const { controller, oauthService } = makeController({ oauthService: { completeLogin: jest.fn().mockResolvedValue({ id: 'acc-1' }) } });
    const res = fakeResponse();

    await controller.callback('a-code', 'good-state', res);

    expect(oauthService.completeLogin).toHaveBeenCalledWith('a-code', 'good-state');
    expect(res.redirect).toHaveBeenCalledWith('/accounts/acc-1');
  });

  it('responds 400 with a plain message when the login cannot be completed', async () => {
    const { controller } = makeController({
      oauthService: { completeLogin: jest.fn().mockRejectedValue(new Error('Ссылка для входа устарела, попробуйте подключить аккаунт заново')) },
    });
    const res = fakeResponse();

    await controller.callback('a-code', 'bad-state', res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Ссылка для входа устарела, попробуйте подключить аккаунт заново' });
  });
});

describe('InstagramOauthController.deauthorize', () => {
  it('marks the matching account for reconnect and answers 200', async () => {
    const { createHmac } = require('crypto');
    const base64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const encodedPayload = base64url(JSON.stringify({ user_id: '17841400000000000' }));
    const signature = base64url(createHmac('sha256', 'app-secret').update(encodedPayload).digest());
    const signedRequest = `${signature}.${encodedPayload}`;

    const { controller, accountsRepo, credentialsRepo } = makeController({
      accountsRepo: { findOneBy: jest.fn().mockResolvedValue({ id: 'acc-1', platform: AccountPlatform.INSTAGRAM, externalId: '17841400000000000' }) },
    });
    const res = fakeResponse();

    await controller.deauthorize({ signed_request: signedRequest }, res);

    expect(credentialsRepo.update).toHaveBeenCalledWith({ accountId: 'acc-1' }, { needsReconnect: true });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('answers 200 without touching anything when the signature is invalid', async () => {
    const { controller, credentialsRepo } = makeController();
    const res = fakeResponse();

    await controller.deauthorize({ signed_request: 'not-a-real-signed-request' }, res);

    expect(credentialsRepo.update).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('InstagramOauthController.dataDeletion', () => {
  it('deletes the credential and returns the confirmation shape Meta requires', async () => {
    const { createHmac } = require('crypto');
    const base64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const encodedPayload = base64url(JSON.stringify({ user_id: '17841400000000000' }));
    const signature = base64url(createHmac('sha256', 'app-secret').update(encodedPayload).digest());
    const signedRequest = `${signature}.${encodedPayload}`;

    const { controller, accountsRepo, credentialsRepo } = makeController({
      accountsRepo: { findOneBy: jest.fn().mockResolvedValue({ id: 'acc-1', platform: AccountPlatform.INSTAGRAM, externalId: '17841400000000000' }) },
    });
    const res = fakeResponse();

    await controller.dataDeletion({ signed_request: signedRequest }, res);

    expect(credentialsRepo.delete).toHaveBeenCalledWith({ accountId: 'acc-1' });
    const body = res.json.mock.calls[0][0];
    expect(body.confirmation_code).toBeDefined();
    expect(typeof body.url).toBe('string');
  });
});
