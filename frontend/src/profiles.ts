/** Shapes served by GET /profiles and GET /profiles/:id. */
export interface ProfileAccountItem {
  account: { id: string; platform: string; name: string; avatarUrl: string | null; type: string };
  latestSnapshot: { followersCount: number; avgEr: number | null } | null;
}

export interface ProfileSummary {
  id: string;
  name: string;
  totalFollowers: number | null;
  /** Most followers first; empty for a project with no accounts yet. */
  accounts: ProfileAccountItem[];
}
