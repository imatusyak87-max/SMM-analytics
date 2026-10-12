/** Shapes served by GET /profiles and GET /profiles/:id. */
export interface ProfileAccountItem {
  account: { id: string; platform: string; name: string; avatarUrl: string | null; type: string };
  latestSnapshot: { followersCount: number; avgEr: number | null } | null;
}

export interface ProfileSummary {
  id: string;
  name: string;
  totalFollowers: number | null;
  /** Most followers first; never empty. */
  accounts: ProfileAccountItem[];
}

/** A profile page with one account on it would be a needless extra click. */
export function profileHref(profile: ProfileSummary): string {
  return profile.accounts.length === 1 ? `/accounts/${profile.accounts[0].account.id}` : `/profiles/${profile.id}`;
}
