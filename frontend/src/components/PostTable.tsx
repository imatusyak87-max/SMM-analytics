import styles from './PostTable.module.css';
import { formatCount, formatPercent } from '../format';
import { isRoundVideo } from '../postType';
import type { PostItem } from './PostList';
import type { ExtraPostMetric } from '../postMetrics';

const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

interface PostTableProps {
  posts: PostItem[];
  total: number;
  onOpen: (post: PostItem) => void;
  /** Columns after «Реакции», for the metrics this account really has. */
  extraMetrics?: ExtraPostMetric[];
}

export function PostTable({ posts, total, onOpen, extraMetrics = [] }: PostTableProps) {
  return (
    <div className={styles.wrap}>
      <p className={styles.total}>Всего постов: {formatCount(total)}</p>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Дата и время</th>
              <th scope="col">Пост</th>
              <th scope="col" className={styles.num}>Просмотры</th>
              <th scope="col" className={styles.num}>Реакции</th>
              {extraMetrics.map((metric) => (
                <th key={metric.key} scope="col" className={styles.num}>{metric.label}</th>
              ))}
              <th scope="col" className={styles.num}>ERR</th>
              <th scope="col" className={styles.num}>ER</th>
            </tr>
          </thead>
          <tbody>
            {posts.map((post) => (
              <tr
                key={post.id}
                className={styles.row}
                onClick={(event) => {
                  // Focus the row's button wherever the row was clicked, so the
                  // modal has somewhere to return focus to on close (and Safari,
                  // which does not focus a clicked <button>, behaves the same).
                  event.currentTarget.querySelector('button')?.focus();
                  onOpen(post);
                }}
              >
                <td className={styles.date}>
                  <time dateTime={post.publishedAt}>{dateTimeFormat.format(new Date(post.publishedAt))}</time>
                </td>
                <td>
                  {/* The keyboard and screen-reader handle for the row. It has no
                      handler of its own: its click bubbles to the row, so onOpen
                      runs once. */}
                  <button type="button" className={styles.post}>
                    {post.thumbnailUrl && (
                      <img
                        className={isRoundVideo(post) ? `${styles.thumb} ${styles.round}` : styles.thumb}
                        src={post.thumbnailUrl}
                        alt=""
                      />
                    )}
                    <span className={styles.caption}>
                      {post.caption ?? (isRoundVideo(post) ? 'Кружочек' : 'Без текста')}
                    </span>
                  </button>
                </td>
                <td className={styles.num}>{formatCount(post.views)}</td>
                <td className={styles.num}>{formatCount(post.likes)}</td>
                {extraMetrics.map((metric) => (
                  <td key={metric.key} className={styles.num}>{formatCount(post[metric.key])}</td>
                ))}
                <td className={styles.num}>{formatPercent(post.erViews)}</td>
                <td className={styles.num}>{formatPercent(post.er)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
