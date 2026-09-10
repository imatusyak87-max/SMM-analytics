export function calculateEr(
  likes: number,
  comments: number,
  shares: number,
  followersCount: number,
): number | null {
  if (followersCount <= 0) return null;
  return ((likes + comments + shares) / followersCount) * 100;
}

/**
 * Engagement against actual reach. On Telegram this is the more meaningful figure:
 * a post reaches a fraction of subscribers, so measuring against followers punishes
 * a large channel for Telegram's delivery rather than for its content.
 */
export function calculateErByViews(reactions: number, views: number | null): number | null {
  if (views === null || views <= 0) return null;
  return (reactions / views) * 100;
}
