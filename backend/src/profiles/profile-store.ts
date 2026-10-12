import { NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Account } from '../db/entities/account.entity';
import { Profile } from '../db/entities/profile.entity';

export const PROFILE_NOT_FOUND = 'Профиль не найден';

/*
 * Each helper takes the caller's EntityManager, so it runs inside the caller's
 * transaction: creating an account and its profile, or moving an account and
 * removing the profile it left empty, commit or fail together.
 */

export function createProfile(em: EntityManager, name: string): Promise<Profile> {
  return em.save(Profile, { name });
}

/** A profile must never outlive its last account. */
export async function deleteProfileIfEmpty(em: EntityManager, profileId: string): Promise<void> {
  const remaining = await em.count(Account, { where: { profileId } });
  if (remaining === 0) await em.delete(Profile, { id: profileId });
}

export async function requireProfile(em: EntityManager, id: string): Promise<Profile> {
  const profile = await em.findOneBy(Profile, { id });
  if (!profile) throw new NotFoundException(PROFILE_NOT_FOUND);
  return profile;
}
