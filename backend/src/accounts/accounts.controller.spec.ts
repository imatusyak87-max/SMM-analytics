import { AccountsController } from './accounts.controller';

describe('AccountsController', () => {
  it('creates an account from a pasted link', async () => {
    const created = { id: 'acc-1' };
    const service = {
      createFromLink: jest.fn().mockResolvedValue(created),
    } as any;
    const controller = new AccountsController(service);

    const result = await controller.createFromLink({
      link: 'https://t.me/fedulovadigital',
    });

    expect(service.createFromLink).toHaveBeenCalledWith(
      'https://t.me/fedulovadigital',
    );
    expect(result).toBe(created);
  });
});
