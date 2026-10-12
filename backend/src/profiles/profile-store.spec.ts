import { NotFoundException } from '@nestjs/common';
import { Account } from '../db/entities/account.entity';
import { Profile } from '../db/entities/profile.entity';
import { createProfile, deleteProfileIfEmpty, requireProfile, PROFILE_NOT_FOUND } from './profile-store';

function fakeEm(overrides: Record<string, jest.Mock> = {}) {
  return {
    save: jest.fn((_target: unknown, row: object) => Promise.resolve({ id: 'prof-new', ...row })),
    count: jest.fn().mockResolvedValue(0),
    delete: jest.fn(),
    findOneBy: jest.fn().mockResolvedValue(null),
    ...overrides,
  } as any;
}

describe('profile-store', () => {
  it('creates a profile with the given name', async () => {
    const em = fakeEm();

    const profile = await createProfile(em, 'Coffee Lab');

    expect(em.save).toHaveBeenCalledWith(Profile, { name: 'Coffee Lab' });
    expect(profile).toEqual({ id: 'prof-new', name: 'Coffee Lab' });
  });

  it('deletes a profile no account points to any more', async () => {
    const em = fakeEm({ count: jest.fn().mockResolvedValue(0) });

    await deleteProfileIfEmpty(em, 'prof-1');

    expect(em.count).toHaveBeenCalledWith(Account, { where: { profileId: 'prof-1' } });
    expect(em.delete).toHaveBeenCalledWith(Profile, { id: 'prof-1' });
  });

  it('keeps a profile that still has accounts', async () => {
    const em = fakeEm({ count: jest.fn().mockResolvedValue(2) });

    await deleteProfileIfEmpty(em, 'prof-1');

    expect(em.delete).not.toHaveBeenCalled();
  });

  it('returns an existing profile', async () => {
    const em = fakeEm({ findOneBy: jest.fn().mockResolvedValue({ id: 'prof-1', name: 'X' }) });

    await expect(requireProfile(em, 'prof-1')).resolves.toEqual({ id: 'prof-1', name: 'X' });
    expect(em.findOneBy).toHaveBeenCalledWith(Profile, { id: 'prof-1' });
  });

  it('throws a Russian 404 for a missing profile', async () => {
    const em = fakeEm();

    await expect(requireProfile(em, 'nope')).rejects.toThrow(new NotFoundException(PROFILE_NOT_FOUND));
  });
});
