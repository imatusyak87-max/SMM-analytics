import styles from './PostSortSelect.module.css';
import type { PostSort } from './PostList';

const SORTS: Array<{ value: PostSort; label: string }> = [
  { value: 'views', label: 'Просмотры' },
  { value: 'reactions', label: 'Реакции' },
  { value: 'er', label: 'ER' },
  { value: 'date', label: 'Дата' },
];

interface PostSortSelectProps {
  value: PostSort;
  onChange: (value: PostSort) => void;
}

export function PostSortSelect({ value, onChange }: PostSortSelectProps) {
  return (
    <div className={styles.group} role="group" aria-label="Сортировка">
      {SORTS.map((sort) => (
        <button
          key={sort.value}
          type="button"
          className={sort.value === value ? styles.active : styles.option}
          aria-pressed={sort.value === value}
          onClick={() => onChange(sort.value)}
        >
          {sort.label}
        </button>
      ))}
    </div>
  );
}
