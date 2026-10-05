import { InstagramDiscoveryController } from './instagram-discovery.controller';

function makeRes() {
  return { redirect: jest.fn() } as any;
}

describe('InstagramDiscoveryController', () => {
  const connection = { status: jest.fn().mockResolvedValue({ connected: true, needsReconnect: false, username: 'fdagency' }) };

  it('returns the dialog URL', async () => {
    const oauth = { buildAuthorizeUrl: jest.fn().mockResolvedValue('https://www.facebook.com/dialog') };
    const controller = new InstagramDiscoveryController(oauth as any, connection as any);

    expect(await controller.connect()).toEqual({ redirectUrl: 'https://www.facebook.com/dialog' });
  });

  it('returns the connection status', async () => {
    const controller = new InstagramDiscoveryController({} as any, connection as any);

    expect(await controller.status()).toEqual({ connected: true, needsReconnect: false, username: 'fdagency' });
  });

  it('sends the browser back to the add-competitor dialog after a successful login', async () => {
    const oauth = { completeLogin: jest.fn().mockResolvedValue(undefined) };
    const res = makeRes();

    await new InstagramDiscoveryController(oauth as any, connection as any).callback('the-code', 'state-uuid', res);

    expect(oauth.completeLogin).toHaveBeenCalledWith('the-code', 'state-uuid');
    expect(res.redirect).toHaveBeenCalledWith('/?add=competitor');
  });

  it("carries a failed login's message back to the dialog", async () => {
    const oauth = { completeLogin: jest.fn().mockRejectedValue(new Error('Ссылка для входа устарела')) };
    const res = makeRes();

    await new InstagramDiscoveryController(oauth as any, connection as any).callback('the-code', 'state-uuid', res);

    expect(res.redirect).toHaveBeenCalledWith(`/?add=competitor&discoveryError=${encodeURIComponent('Ссылка для входа устарела')}`);
  });

  it('treats a callback without a code (the user cancelled) as a cancelled login', async () => {
    const oauth = { completeLogin: jest.fn() };
    const res = makeRes();

    await new InstagramDiscoveryController(oauth as any, connection as any).callback(undefined, 'state-uuid', res);

    expect(oauth.completeLogin).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(`/?add=competitor&discoveryError=${encodeURIComponent('Вход через Facebook отменён')}`);
  });
});
