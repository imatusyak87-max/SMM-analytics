import { Test } from '@nestjs/testing';
import { DbModule } from '../src/db/db.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account, AccountPlatform, AccountType } from '../src/db/entities/account.entity';
import { AccountSnapshot } from '../src/db/entities/account-snapshot.entity';

describe('DB round-trip', () => {
  let accountRepo: Repository<Account>;
  let snapshotRepo: Repository<AccountSnapshot>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DbModule] }).compile();
    accountRepo = moduleRef.get(getRepositoryToken(Account));
    snapshotRepo = moduleRef.get(getRepositoryToken(AccountSnapshot));
  });

  it('creates an account and a snapshot referencing it', async () => {
    const account = await accountRepo.save({
      platform: AccountPlatform.TELEGRAM,
      externalId: '@testchannel',
      name: 'Test Channel',
      avatarUrl: null,
      type: AccountType.OWN,
    });

    const snapshot = await snapshotRepo.save({
      accountId: account.id,
      date: '2026-08-13',
      followersCount: 100,
      followingCount: null,
      postsCount: 5,
      avgReach: null,
      avgEr: 2.5,
    });

    const found = await snapshotRepo.findOneBy({ id: snapshot.id });
    expect(found?.accountId).toBe(account.id);
    expect(found?.followersCount).toBe(100);
  });
});
