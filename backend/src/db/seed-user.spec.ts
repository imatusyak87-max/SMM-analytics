import * as bcrypt from 'bcrypt';
import { seedUser } from './seed-user';

describe('seedUser', () => {
  it('upserts a user with a bcrypt-hashed password, keyed by email', async () => {
    const repo = { upsert: jest.fn() } as any;

    await seedUser(repo, 'admin@example.com', 'correct-horse', 'Admin');

    expect(repo.upsert).toHaveBeenCalledTimes(1);
    const [record, conflictPaths] = repo.upsert.mock.calls[0];
    expect(record.email).toBe('admin@example.com');
    expect(record.name).toBe('Admin');
    expect(conflictPaths).toEqual(['email']);
    expect(await bcrypt.compare('correct-horse', record.passwordHash)).toBe(true);
  });
});
