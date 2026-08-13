import { AccountsService } from './accounts.service';
import { AccountPlatform, AccountType } from '../db/entities/account.entity';

describe('AccountsService', () => {
  it('creates an account with isActive true by default', async () => {
    const saved = { id: '1' };
    const repo = { save: jest.fn().mockResolvedValue(saved), create: jest.fn((x) => x) } as any;
    const service = new AccountsService(repo);

    const result = await service.create({
      platform: AccountPlatform.TELEGRAM,
      externalId: '@chan',
      name: 'Chan',
      type: AccountType.OWN,
    });

    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ isActive: true }));
    expect(result).toBe(saved);
  });
});
