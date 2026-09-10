import styles from './PostTypeFilter.module.css';

const TYPES: Array<{ value: string; label: string }> = [
  { value: 'image', label: 'Изображение' },
  { value: 'video', label: 'Видео' },
  { value: 'post', label: 'Текст' },
];

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
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
  );
}
