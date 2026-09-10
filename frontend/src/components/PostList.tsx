import styles from './PostList.module.css';
import { formatCount, formatPercent } from '../format';

export type PostSort = 'views' | 'reactions' | 'er' | 'date';

/** One post from the `posts` array of GET /accounts/:id/detail. */
export interface PostItem {
  id: string;
  type: string;
  caption: string | null;
  publishedAt: string;
  thumbnailUrl: string | null;
  permalink: string;
  views: number | null;
  likes: number;
  er: number | null;
  erViews: number | null;
}

interface PostListProps {
  posts: PostItem[];
  sort: PostSort;
  onOpen: (post: PostItem) => void;
}

const COMPARATORS: Record<PostSort, (a: PostItem, b: PostItem) => number> = {
  views: (a, b) => (b.views ?? 0) - (a.views ?? 0),
  reactions: (a, b) => b.likes - a.likes,
  er: (a, b) => (b.erViews ?? 0) - (a.erViews ?? 0),
  date: (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
};

export function PostList({ posts, sort, onOpen }: PostListProps) {
  if (posts.length === 0) {
    return <p className={styles.empty}>Постов за этот период нет.</p>;
  }

  const sorted = [...posts].sort(COMPARATORS[sort]);

  return (
    <ul className={styles.list}>
      {sorted.map((post) => (
        <li key={post.id} className={styles.item}>
          <button type="button" className={styles.card} onClick={() => onOpen(post)}>
            {post.thumbnailUrl && (
              <img className={styles.thumb} src={post.thumbnailUrl} alt={post.caption ?? ''} />
            )}
            {post.caption && <span className={styles.caption}>{post.caption}</span>}
            <div className={styles.metrics}>
              <span className={styles.metric}>
                <span className={styles.metricValue}>{formatCount(post.views)}</span>
                <span className={styles.metricLabel}>просмотры</span>
              </span>
              <span className={styles.metric}>
                <span className={styles.metricValue}>{formatCount(post.likes)}</span>
                <span className={styles.metricLabel}>реакции</span>
              </span>
              <span className={styles.metric}>
                <span className={styles.metricValue}>{formatPercent(post.er)}</span>
                <span className={styles.metricLabel}>ER</span>
              </span>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
