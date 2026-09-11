import { useEffect, useRef } from 'react';
import styles from './PostModal.module.css';
import { formatCount, formatPercent } from '../format';
import { isRoundVideo } from '../postType';
import type { PostItem } from './PostList';

interface PostModalProps {
  post: PostItem | null;
  onClose: () => void;
}

const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

export function PostModal({ post, onClose }: PostModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!post) return;
    // Remember what had focus before the modal opened, so closing can return it.
    openerRef.current = document.activeElement;
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (openerRef.current instanceof HTMLElement) openerRef.current.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post]);

  if (!post) return null;

  return (
    <div className={styles.backdrop} data-testid="post-modal-backdrop" onClick={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Публикация"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          ref={closeButtonRef}
          aria-label="Закрыть"
        >
          ×
        </button>
        {post.thumbnailUrl && (
          <img
            className={isRoundVideo(post) ? `${styles.image} ${styles.round}` : styles.image}
            src={post.thumbnailUrl}
            alt=""
          />
        )}
        <time className={styles.date} dateTime={post.publishedAt}>
          {dateTimeFormat.format(new Date(post.publishedAt))}
        </time>
        {post.caption && <p className={styles.caption}>{post.caption}</p>}
        <dl className={styles.metrics}>
          <div className={styles.metric}>
            <dt className={styles.label}>Просмотры</dt>
            <dd className={styles.value}>{formatCount(post.views)}</dd>
          </div>
          <div className={styles.metric}>
            <dt className={styles.label}>Реакции</dt>
            <dd className={styles.value}>{formatCount(post.likes)}</dd>
          </div>
          <div className={styles.metric}>
            <dt className={styles.label}>ERR к просмотрам</dt>
            <dd className={styles.value}>{formatPercent(post.erViews)}</dd>
          </div>
          <div className={styles.metric}>
            <dt className={styles.label}>ER к подписчикам</dt>
            <dd className={styles.value}>{formatPercent(post.er)}</dd>
            <dd className={styles.note}>по текущему числу подписчиков</dd>
          </div>
        </dl>
        <a
          className={styles.link}
          href={post.permalink}
          target="_blank"
          rel="noopener noreferrer"
        >
          Открыть в Telegram
        </a>
      </div>
    </div>
  );
}
