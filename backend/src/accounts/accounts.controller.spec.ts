import { AccountsController } from './accounts.controller';

describe('AccountsController', () => {
  it('creates an account from a pasted link', async () => {
    const created = { id: 'acc-1' };
    const service = {
      createFromLink: jest.fn().mockResolvedValue(created),
    } as any;
    const controller = new AccountsController(service, {} as any);

    const result = await controller.createFromLink({
      link: 'https://t.me/somechannel',
    });

    expect(service.createFromLink).toHaveBeenCalledWith(
      'https://t.me/somechannel',
    );
    expect(result).toBe(created);
  });

  it('previews a link without creating anything', async () => {
    const preview = { name: 'Some Channel', followersCount: 10 };
    const service = { preview: jest.fn().mockResolvedValue(preview) } as any;
    const controller = new AccountsController(service, {} as any);

    const result = await controller.preview({ link: 'https://t.me/somechannel' });

    expect(service.preview).toHaveBeenCalledWith('https://t.me/somechannel');
    expect(result).toBe(preview);
  });

  it('streams an avatar with the content type the platform reported', async () => {
    const service = {
      getAvatar: jest.fn().mockResolvedValue({ data: Buffer.from('img'), contentType: 'image/png' }),
    } as any;
    const controller = new AccountsController(service, {} as any);
    const res = { set: jest.fn(), send: jest.fn() } as any;

    await controller.avatar('acc-1', res);

    expect(res.set).toHaveBeenCalledWith(expect.objectContaining({ 'Content-Type': 'image/png' }));
    expect(res.send).toHaveBeenCalledWith(Buffer.from('img'));
  });

  it('deletes an account by id', async () => {
    const service = { remove: jest.fn().mockResolvedValue(undefined) } as any;
    const controller = new AccountsController(service, {} as any);

    await controller.remove('acc-1');

    expect(service.remove).toHaveBeenCalledWith('acc-1');
  });
});

describe('AccountsController.connectInstagram', () => {
  it('returns the authorize URL for the requested account type', async () => {
    const oauthService = { buildAuthorizeUrl: jest.fn().mockResolvedValue('https://www.instagram.com/oauth/authorize?...') };
    const controller = new AccountsController({} as any, oauthService as any);

    const result = await controller.connectInstagram('own');

    expect(oauthService.buildAuthorizeUrl).toHaveBeenCalledWith('own');
    expect(result).toEqual({ redirectUrl: 'https://www.instagram.com/oauth/authorize?...' });
  });
});
