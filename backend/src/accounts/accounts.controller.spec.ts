import { AccountsController } from './accounts.controller';

describe('AccountsController', () => {
  it('creates an account from a pasted link', async () => {
    const created = { id: 'acc-1' };
    const service = {
      createFromLink: jest.fn().mockResolvedValue(created),
    } as any;
    const controller = new AccountsController(service);

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
    const controller = new AccountsController(service);

    const result = await controller.preview({ link: 'https://t.me/somechannel' });

    expect(service.preview).toHaveBeenCalledWith('https://t.me/somechannel');
    expect(result).toBe(preview);
  });

  it('streams an avatar with the content type the platform reported', async () => {
    const service = {
      getAvatar: jest.fn().mockResolvedValue({ data: Buffer.from('img'), contentType: 'image/png' }),
    } as any;
    const controller = new AccountsController(service);
    const res = { set: jest.fn(), send: jest.fn() } as any;

    await controller.avatar('acc-1', res);

    expect(res.set).toHaveBeenCalledWith(expect.objectContaining({ 'Content-Type': 'image/png' }));
    expect(res.send).toHaveBeenCalledWith(Buffer.from('img'));
  });

  it('deletes an account by id', async () => {
    const service = { remove: jest.fn().mockResolvedValue(undefined) } as any;
    const controller = new AccountsController(service);

    await controller.remove('acc-1');

    expect(service.remove).toHaveBeenCalledWith('acc-1');
  });
});
