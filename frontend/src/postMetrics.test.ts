import { describe, it, expect } from 'vitest';
import { extraPostMetrics } from './postMetrics';

describe('extraPostMetrics', () => {
  it('shows comments, shares and reach for an Instagram account the user owns', () => {
    expect(extraPostMetrics({ platform: 'instagram', type: 'own' }).map((m) => m.key)).toEqual(['comments', 'shares', 'reach']);
    expect(extraPostMetrics({ platform: 'instagram', type: 'client' }).map((m) => m.key)).toEqual(['comments', 'shares', 'reach']);
  });

  // Meta gives no shares or reach for someone else's account; the stored 0 / null would mislead.
  it('shows only comments for an Instagram competitor', () => {
    expect(extraPostMetrics({ platform: 'instagram', type: 'public_no_access' }).map((m) => m.key)).toEqual(['comments']);
  });

  // The Telegram connector stores 0 comments, 0 shares and no reach for every post.
  it('shows none for Telegram', () => {
    expect(extraPostMetrics({ platform: 'telegram', type: 'public_no_access' })).toEqual([]);
    expect(extraPostMetrics({ platform: 'telegram', type: 'own' })).toEqual([]);
  });

  it('labels each metric in Russian', () => {
    expect(extraPostMetrics({ platform: 'instagram', type: 'own' }).map((m) => m.label)).toEqual(['Комментарии', 'Репосты', 'Охват']);
  });
});
