import { useEffect, useRef, useState } from 'react';
import { DayPicker, type DateRange } from '@daypicker/react';
import { ru } from '@daypicker/react/locale';
import '@daypicker/react/style.css';
import styles from './PeriodPicker.module.css';
import {
  PRESETS,
  formatPeriod,
  fromIsoDate,
  selectPreset,
  toIsoDate,
  type SelectedPeriod,
} from '../periods';

interface PeriodPickerProps {
  value: SelectedPeriod;
  onChange: (next: SelectedPeriod) => void;
  /** Injectable so tests do not depend on the real date. */
  today?: Date;
}

/** Narrow screens get one month, since two side by side do not fit. */
function monthsToShow(): number {
  const narrow =
    typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches;
  return narrow ? 1 : 2;
}

export function PeriodPicker({ value, onChange, today = new Date() }: PeriodPickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  function openCalendar() {
    setDraft({ from: fromIsoDate(value.from), to: fromIsoDate(value.to) });
    setOpen(true);
  }

  // The first click after opening starts a new range rather than stretching the
  // current one; the second closes it, on whichever side of the first it falls.
  function pickDay(_range: DateRange | undefined, day: Date) {
    if (!draft?.from || draft.to) {
      setDraft({ from: day, to: undefined });
    } else if (day < draft.from) {
      setDraft({ from: day, to: draft.from });
    } else {
      setDraft({ from: draft.from, to: day });
    }
  }

  function apply() {
    if (!draft?.from) return;
    onChange({ preset: null, from: toIsoDate(draft.from), to: toIsoDate(draft.to ?? draft.from) });
    setOpen(false);
  }

  const label = formatPeriod(value);

  return (
    <div className={styles.bar}>
      <div className={styles.presets} role="group" aria-label="Период">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={preset.id === value.preset ? styles.active : styles.option}
            aria-pressed={preset.id === value.preset}
            onClick={() => onChange(selectPreset(preset.id, today))}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className={styles.calendar} ref={wrapRef}>
        <button
          type="button"
          className={value.preset === null ? styles.calendarActive : styles.calendarButton}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Выбрать даты: ${label}`}
          onClick={() => (open ? setOpen(false) : openCalendar())}
        >
          {label}
        </button>
        {open && (
          <div className={styles.popover} role="dialog" aria-label="Выбор периода">
            <DayPicker
              mode="range"
              locale={ru}
              weekStartsOn={1}
              numberOfMonths={monthsToShow()}
              defaultMonth={draft?.from}
              endMonth={today}
              selected={draft}
              onSelect={pickDay}
              disabled={{ after: today }}
            />
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} onClick={() => setOpen(false)}>
                Отмена
              </button>
              <button
                type="button"
                className={styles.primary}
                disabled={!draft?.from}
                onClick={apply}
              >
                Применить
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
