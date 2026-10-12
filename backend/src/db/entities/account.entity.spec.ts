import { getMetadataArgsStorage } from 'typeorm';
import { Account } from './account.entity';
import { Profile } from './profile.entity';

describe('Account entity', () => {
  it('declares platform and externalId unique together, so duplicates cannot be stored', () => {
    const uniques = getMetadataArgsStorage()
      .uniques.filter((u) => u.target === Account)
      .map((u) => u.columns as string[]);

    expect(uniques).toContainEqual(['platform', 'externalId']);
  });

  it('belongs to a profile through profileId', () => {
    const relation = getMetadataArgsStorage().relations.find(
      (r) => r.target === Account && r.propertyName === 'profile',
    );
    expect(relation?.relationType).toBe('many-to-one');
    expect((relation?.type as () => unknown)()).toBe(Profile);

    const column = getMetadataArgsStorage().columns.find(
      (c) => c.target === Account && c.propertyName === 'profileId',
    );
    expect(column).toBeDefined();
  });
});
