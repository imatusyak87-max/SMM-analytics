export function calculateEr(
  likes: number,
  comments: number,
  shares: number,
  followersCount: number,
): number | null {
  if (followersCount <= 0) return null;
  return ((likes + comments + shares) / followersCount) * 100;
}
