import { AddProfiles1789900000000 } from './migrations/1789900000000-AddProfiles';

function recordingRunner() {
  const sql: string[] = [];
  return {
    sql,
    runner: {
      query: jest.fn((q: string) => {
        sql.push(q.replace(/\s+/g, ' ').trim());
      }),
    } as any,
  };
}

describe('AddProfiles migration', () => {
  it('gives every existing account its own profile before requiring one', async () => {
    const { sql, runner } = recordingRunner();

    await new AddProfiles1789900000000().up(runner);

    const createTable = sql.findIndex((q) =>
      q.startsWith('CREATE TABLE "profiles"'),
    );
    const addColumn = sql.findIndex((q) => q.includes('ADD "profileId" uuid'));
    const backfillProfiles = sql.findIndex((q) =>
      q.startsWith(
        'INSERT INTO "profiles" ("id", "name", "createdAt") SELECT "id", "name", "createdAt" FROM "accounts"',
      ),
    );
    const linkAccounts = sql.findIndex(
      (q) => q === 'UPDATE "accounts" SET "profileId" = "id"',
    );
    const notNull = sql.findIndex((q) =>
      q.includes('ALTER COLUMN "profileId" SET NOT NULL'),
    );
    const fk = sql.findIndex((q) =>
      q.includes('FOREIGN KEY ("profileId") REFERENCES "profiles"("id")'),
    );

    for (const index of [
      createTable,
      addColumn,
      backfillProfiles,
      linkAccounts,
      notNull,
      fk,
    ]) {
      expect(index).toBeGreaterThanOrEqual(0);
    }
    expect(createTable).toBeLessThan(backfillProfiles);
    expect(addColumn).toBeLessThan(linkAccounts);
    expect(backfillProfiles).toBeLessThan(linkAccounts);
    expect(linkAccounts).toBeLessThan(notNull);
    expect(notNull).toBeLessThan(fk);
  });

  it('drops the column before the table on the way down', async () => {
    const { sql, runner } = recordingRunner();

    await new AddProfiles1789900000000().down(runner);

    const dropColumn = sql.findIndex((q) =>
      q.includes('DROP COLUMN "profileId"'),
    );
    const dropTable = sql.findIndex((q) => q === 'DROP TABLE "profiles"');
    expect(dropColumn).toBeGreaterThanOrEqual(0);
    expect(dropColumn).toBeLessThan(dropTable);
  });
});
