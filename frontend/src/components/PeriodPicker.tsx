import { useEffect, useRef, useState } from 'react';
import { DayPicker, type DateRange } from '@daypicker/react';
import { ru } from '@daypicker/react/locale';
import '@daypicker/react/style.css';
import styles from './PeriodPicker.module.css';
import {
  PRESETS,
  formatPeriod,
  fromIsoDate,
  presetRange,
  selectPreset,
  toIsoDate,
  type PresetId,
  type SelectedPeriod,
} from '../periods';

interface PeriodPickerProps {
  value: SelectedPeriod;
  onChange: (next: SelectedPeriod) => void;
  /** Injectable so tests do not depend on the real date. */
  today?: Date;
}

/** Narrow screens get one month, since two beside the preset column do not fit. */
function monthsToShow(): number {
  const narrow =
    typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 760px)').matches;
  return narrow ? 1 : 2;
}

/** The first month to show, chosen so the range's last day is in view. */
function firstMonth(end: Date, months: number): Date {
  return new Date(end.getFullYear(), end.getMonth() - (months - 1), 1);
}

const DAY_MS = 86_400_000;

/** `30 дней`, `1 день`, `22 дня`. Rounding absorbs the 23- and 25-hour DST days. */
function daysLabel(from: Date, to: Date): string {
  const n = Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? 'день'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? 'дня'
        : 'дней';
  return `${n} ${word}`;
}

function CalendarIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="12" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function PeriodPicker({ value, onChange, today = new Date() }: PeriodPickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>();
  // The preset behind the draft, until a day is picked by hand.
  const [draftPreset, setDraftPreset] = useState<PresetId | null>(null);
  const [months, setMonths] = useState(2);
  const [month, setMonth] = useState<Date>(today);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Closing via keyboard or the dialog's own buttons unmounts whatever had
  // focus inside the popover, so focus must be sent back to the trigger.
  // An outside click already moved focus elsewhere on its own; don't steal it.
  function close(restoreFocus: boolean) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(true);
    };
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  function openCalendar() {
    const count = monthsToShow();
    const to = fromIsoDate(value.to);
    setDraft({ from: fromIsoDate(value.from), to });
    setDraftPreset(value.preset);
    setMonths(count);
    setMonth(firstMonth(to, count));
    setOpen(true);
  }

  // A preset inside the dialog only previews: like a hand-picked range, it
  // takes effect on «Применить».
  function pickPreset(preset: PresetId) {
    const range = presetRange(preset, today);
    const to = fromIsoDate(range.to);
    setDraft({ from: fromIsoDate(range.from), to });
    setDraftPreset(preset);
    setMonth(firstMonth(to, months));
  }

  // The first click after opening starts a new range rather than stretching the
  // current one; the second closes it, on whichever side of the first it falls.
  function pickDay(_range: DateRange | undefined, day: Date) {
    setDraftPreset(null);
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
    onChange(
      draftPreset
        ? selectPreset(draftPreset, today)
        : { preset: null, from: toIsoDate(draft.from), to: toIsoDate(draft.to ?? draft.from) },
    );
    close(true);
  }

  const label = formatPeriod(value);
  // A lone first click applies as a one-day period, so it reads as one.
  const draftEnd = draft?.to ?? draft?.from;

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
      <div ref={wrapRef}>
        <button
          ref={triggerRef}
          type="button"
          className={value.preset === null ? styles.calendarActive : styles.calendarButton}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Выбрать даты: ${label}`}
          onClick={() => (open ? setOpen(false) : openCalendar())}
        >
          <CalendarIcon />
          {label}
        </button>
        {open && (
          <div className={styles.popover} role="dialog" aria-label="Выбор периода">
            <div className={styles.quick} role="group" aria-label="Быстрый выбор">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={preset.id === draftPreset ? styles.quickActive : styles.quickOption}
                  aria-pressed={preset.id === draftPreset}
                  onClick={() => pickPreset(preset.id)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className={styles.main}>
              <DayPicker
                mode="range"
                locale={ru}
                weekStartsOn={1}
                numberOfMonths={months}
                month={month}
                onMonthChange={setMonth}
                endMonth={today}
                selected={draft}
                onSelect={pickDay}
                disabled={{ after: today }}
              />
              <div className={styles.footer}>
                <p className={styles.readout} aria-live="polite">
                  {draft?.from && draftEnd && (
                    <>
                      <span className={styles.range}>
                        {formatPeriod({ from: toIsoDate(draft.from), to: toIsoDate(draftEnd) })}
                      </span>
                      <span className={styles.length}>{daysLabel(draft.from, draftEnd)}</span>
                    </>
                  )}
                </p>
                <div className={styles.actions}>
                  <button type="button" className={styles.secondary} onClick={() => close(true)}>
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
