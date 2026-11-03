import { NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Profile } from '../db/entities/profile.entity';

export const PROFILE_NOT_FOUND = 'Проект не найден';

/*
 * Each helper takes the caller's EntityManager, so it runs inside the caller's
 * transaction: creating an account and its profile, or moving an account to a
 * new profile, commit or fail together.
 */

export function createProfile(em: EntityManager, name: string): Promise<Profile> {
  return em.save(Profile, { name });
}

export async function requireProfile(em: EntityManager, id: string): Promise<Profile> {
  const profile = await em.findOneBy(Profile, { id });
  if (!profile) throw new NotFoundException(PROFILE_NOT_FOUND);
  return profile;
}
