import styles from './Pagination.module.css';
import { pageItems } from './pageItems';

const PAGE_SIZES = [10, 25, 50, 100] as const;

interface PaginationProps {
  page: number;
  size: number;
  total: number;
  onPageChange: (page: number) => void;
  onSizeChange: (size: number) => void;
}

export function Pagination({ page, size, total, onPageChange, onSizeChange }: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / size));

  return (
    <div className={styles.pagination}>
      <label className={styles.size}>
        Показывать
        <select
          aria-label="Показывать"
          className={styles.select}
          value={size}
          onChange={(event) => onSizeChange(Number(event.target.value))}
        >
          {PAGE_SIZES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <nav className={styles.pages} aria-label="Страницы">
        <button
          type="button"
          className={styles.step}
          aria-label="Предыдущая страница"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          ‹
        </button>
        {pageItems(page, pageCount).map((item, index) =>
          item === 'gap' ? (
            <span key={`gap-${index}`} className={styles.gap} aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              className={item === page ? styles.current : styles.page}
              aria-current={item === page ? 'page' : undefined}
              aria-label={`Страница ${item}`}
              onClick={() => onPageChange(item)}
            >
              {item}
            </button>
          ),
        )}
        <button
          type="button"
          className={styles.step}
          aria-label="Следующая страница"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          ›
        </button>
      </nav>
    </div>
  );
}
