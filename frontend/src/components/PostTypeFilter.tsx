import styles from './PostTypeFilter.module.css';

const TYPES = ['post', 'reel', 'carousel', 'video', 'short', 'story'];

interface PostTypeFilterProps {
  value: string;
  onChange: (value: string) => void;
}

export function PostTypeFilter({ value, onChange }: PostTypeFilterProps) {
  return (
    <label className={styles.label}>
      Тип поста
      <select
        aria-label="Тип поста"
        className={styles.select}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="all">Все</option>
        {TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </label>
  );
}
