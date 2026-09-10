import styles from './PeriodSelector.module.css';

const PERIODS = [7, 30, 90];

interface PeriodSelectorProps {
  value: number;
  onChange: (days: number) => void;
}

export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  return (
    <div className={styles.group} role="group" aria-label="Период">
      {PERIODS.map((days) => (
        <button
          key={days}
          type="button"
          className={days === value ? styles.active : styles.option}
          aria-pressed={days === value}
          onClick={() => onChange(days)}
        >
          {days} дней
        </button>
      ))}
    </div>
  );
}
