import styles from './PostList.module.css';
import { formatCount, formatPercent } from '../format';
import { isRoundVideo } from '../postType';

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
  onOpen: (post: PostItem) => void;
}

/** Renders posts in the order given: the server sorts, so there is one ordering, not two. */
export function PostList({ posts, onOpen }: PostListProps) {
  if (posts.length === 0) {
    return <p className={styles.empty}>Постов за этот период нет.</p>;
  }

  return (
    <ul className={styles.list}>
      {posts.map((post) => (
        <li key={post.id} className={styles.item}>
          <button
            type="button"
            className={styles.card}
            onClick={(event) => {
              // Safari does not focus a <button> on a plain mouse click, so the
              // modal's "return focus to the card" contract needs this explicit
              // focus() call to hold in every browser, not just Chrome/Firefox.
              event.currentTarget.focus();
              onOpen(post);
            }}
          >
            {post.thumbnailUrl && (
              <img
                className={isRoundVideo(post) ? `${styles.thumb} ${styles.round}` : styles.thumb}
                src={post.thumbnailUrl}
                alt=""
              />
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
                <span className={styles.metricValue}>{formatPercent(post.erViews)}</span>
                <span className={styles.metricLabel}>ERR</span>
              </span>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
