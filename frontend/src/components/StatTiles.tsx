import styles from './StatTiles.module.css';
import { formatCount, formatPercent } from '../format';

/** Mirrors the `summary` object returned by GET /accounts/:id/detail. */
export interface AccountSummary {
  followersCount: number | null;
  postsCount: number;
  totalViews: number;
  totalReactions: number;
  avgViews: number;
  avgReactions: number;
  /** ERR against views, as a percentage. */
  erViews: number | null;
  /** ER against the channel's current subscriber count, as a percentage. */
  erFollowers: number | null;
}

/**
 * Layout groups. On wide screens the top row holds engagement and audience (three
 * wide tiles), the second row the four volume figures; below 1024px it becomes two
 * columns with the audience tile spanning both.
 */
type Group = 'engagement' | 'audience' | 'volume';

interface Tile {
  label: string;
  value: string;
  group: Group;
  featured?: boolean;
  note?: string;
}

interface StatTilesProps {
  summary: AccountSummary;
}

export function StatTiles({ summary }: StatTilesProps) {
  const tiles: Tile[] = [
    { label: 'ERR к просмотрам', value: formatPercent(summary.erViews), group: 'engagement', featured: true },
    {
      label: 'ER к подписчикам',
      value: formatPercent(summary.erFollowers),
      group: 'engagement',
      note: 'по текущему числу подписчиков',
    },
    { label: 'Подписчики', value: formatCount(summary.followersCount), group: 'audience' },
    { label: 'Просмотры', value: formatCount(summary.totalViews), group: 'volume' },
    { label: 'Средние просмотры', value: formatCount(summary.avgViews), group: 'volume' },
    { label: 'Реакции', value: formatCount(summary.totalReactions), group: 'volume' },
    { label: 'Средние реакции', value: formatCount(summary.avgReactions), group: 'volume' },
  ];

  return (
    <dl className={styles.tiles}>
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className={[styles.tile, styles[tile.group], tile.featured ? styles.featured : '']
            .filter(Boolean)
            .join(' ')}
        >
          <dt className={styles.label}>{tile.label}</dt>
          <dd className={styles.value}>{tile.value}</dd>
          {tile.note && <dd className={styles.note}>{tile.note}</dd>}
        </div>
      ))}
    </dl>
  );
}
