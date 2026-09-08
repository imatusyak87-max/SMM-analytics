import styles from './PostList.module.css';

interface PostListProps {
  posts: Array<{ id: string; type: string; caption: string | null; likes: number; comments: number; shares: number; publishedAt: string }>;
}

export function PostList({ posts }: PostListProps) {
  if (posts.length === 0) {
    return <p className={styles.empty}>Нет постов для выбранного фильтра.</p>;
  }

  return (
    <ul className={styles.list}>
      {posts.map((post) => (
        <li key={post.id} className={styles.post}>
          <span className={styles.caption}>{post.caption}</span>
          <div className={styles.metrics}>
            <span className={styles.metric}>
              <span className={styles.metricValue}>{post.likes}</span>
              <span className={styles.metricLabel}>likes</span>
            </span>
            <span className={styles.metric}>
              <span className={styles.metricValue}>{post.comments}</span>
              <span className={styles.metricLabel}>comments</span>
            </span>
            <span className={styles.metric}>
              <span className={styles.metricValue}>{post.shares}</span>
              <span className={styles.metricLabel}>shares</span>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
