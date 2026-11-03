import { NotFoundException } from '@nestjs/common';
import { Profile } from '../db/entities/profile.entity';
import { createProfile, requireProfile, PROFILE_NOT_FOUND } from './profile-store';

function fakeEm(overrides: Record<string, jest.Mock> = {}) {
  return {
    save: jest.fn((_target: unknown, row: object) => Promise.resolve({ id: 'prof-new', ...row })),
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
