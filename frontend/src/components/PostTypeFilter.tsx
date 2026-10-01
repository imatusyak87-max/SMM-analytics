import styles from './PostTypeFilter.module.css';

type PostTypeOption = { value: string; label: string };

const TELEGRAM_TYPES: PostTypeOption[] = [
  { value: 'image', label: 'Изображение' },
  { value: 'video', label: 'Видео' },
  { value: 'round_video', label: 'Кружочки' },
  { value: 'post', label: 'Текст' },
];

/** «Пост» is a single photo or ordinary video; «Каруселька» holds two or more media items. */
const INSTAGRAM_TYPES: PostTypeOption[] = [
  { value: 'post', label: 'Пост' },
  { value: 'reel', label: 'Рилс' },
  { value: 'carousel', label: 'Каруселька' },
];

const TYPES_BY_PLATFORM: Record<string, PostTypeOption[]> = { instagram: INSTAGRAM_TYPES };

interface PostTypeFilterProps {
  /** The account's platform; each platform has its own kinds of post. */
  platform: string;
  value: string;
  onChange: (value: string) => void;
}

export function PostTypeFilter({ platform, value, onChange }: PostTypeFilterProps) {
  const types = TYPES_BY_PLATFORM[platform] ?? TELEGRAM_TYPES;
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
        {types.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
  );
}
