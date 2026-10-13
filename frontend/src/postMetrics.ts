export interface ExtraPostMetric {
  key: 'comments' | 'shares' | 'reach';
  label: string;
}

const COMMENTS: ExtraPostMetric = { key: 'comments', label: 'Комментарии' };
const SHARES: ExtraPostMetric = { key: 'shares', label: 'Репосты' };
const REACH: ExtraPostMetric = { key: 'reach', label: 'Охват' };

/**
 * Post metrics beyond views and reactions, shown only where they are real:
 * the Telegram connector stores 0 comments, 0 shares and no reach for every post,
 * and Meta gives no shares or reach for an Instagram account we do not own.
 */
export function extraPostMetrics(account: { platform?: string; type?: string }): ExtraPostMetric[] {
  if (account.platform !== 'instagram') return [];
  if (account.type === 'public_no_access') return [COMMENTS];
  return [COMMENTS, SHARES, REACH];
}
