import { getMetadataArgsStorage } from 'typeorm';
import { Account } from './account.entity';

describe('Account entity', () => {
  it('declares platform and externalId unique together, so duplicates cannot be stored', () => {
    const uniques = getMetadataArgsStorage()
      .uniques.filter((u) => u.target === Account)
      .map((u) => u.columns as string[]);

    expect(uniques).toContainEqual(['platform', 'externalId']);
  });
});
