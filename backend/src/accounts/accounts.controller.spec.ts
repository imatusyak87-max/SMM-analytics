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

  it('deletes an account by id', async () => {
    const service = { remove: jest.fn().mockResolvedValue(undefined) } as any;
    const controller = new AccountsController(service);

    await controller.remove('acc-1');

    expect(service.remove).toHaveBeenCalledWith('acc-1');
  });
});
