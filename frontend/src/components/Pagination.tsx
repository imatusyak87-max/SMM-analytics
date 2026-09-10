import styles from './Pagination.module.css';

export const PAGE_SIZES = [10, 25, 50, 100] as const;

/**
 * The page buttons to show: every page when there are at most seven, otherwise
 * the first, the last, and the current page with its neighbours, with 'gap'
 * wherever pages are skipped.
 */
export function pageItems(page: number, count: number): Array<number | 'gap'> {
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1);

  const items: Array<number | 'gap'> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(count - 1, page + 1);
  if (start > 2) items.push('gap');
  for (let p = start; p <= end; p++) items.push(p);
  if (end < count - 1) items.push('gap');
  items.push(count);
  return items;
}

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
