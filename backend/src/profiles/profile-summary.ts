import { Profile } from '../db/entities/profile.entity';
import type { OverviewItem } from '../stats/stats.service';

export interface ProfileSummary {
  id: string;
  name: string;
  /** Followers summed across networks; null until any account has been counted. ER is never blended. */
  totalFollowers: number | null;
  accounts: OverviewItem[];
}

const followersOf = (item: OverviewItem) =>
  item.latestSnapshot?.followersCount ?? null;

export function toProfileSummary(
  profile: Profile,
  items: OverviewItem[],
): ProfileSummary {
  const accounts = [...items].sort(
    (a, b) => (followersOf(b) ?? -1) - (followersOf(a) ?? -1),
  );
  const counted = accounts
    .map(followersOf)
    .filter((n): n is number => n !== null);
  return {
    id: profile.id,
    name: profile.name,
    totalFollowers:
      counted.length > 0 ? counted.reduce((sum, n) => sum + n, 0) : null,
    accounts,
  };
}
