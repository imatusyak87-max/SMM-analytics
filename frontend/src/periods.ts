/**
 * Period presets for the account page and the date helpers they need. Periods
 * travel as `YYYY-MM-DD` strings — the shape the API takes — with `to` inclusive.
 * Dates are built from the user's local calendar day, since "this month" means
 * the month on the user's wall calendar.
 */
export type PresetId =
  | 'last7'
  | 'last30'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisQuarter'
  | 'lastQuarter'
  | 'thisYear'
  | 'lastYear';

export interface Period {
  from: string;
  to: string;
}

/** A period plus the preset that produced it, or null for a range picked on the calendar. */
export interface SelectedPeriod extends Period {
  preset: PresetId | null;
}

export const PRESETS: ReadonlyArray<{ id: PresetId; label: string }> = [
  { id: 'last7', label: 'Последние 7 дней' },
  { id: 'last30', label: 'Последние 30 дней' },
  { id: 'thisMonth', label: 'Этот месяц' },
  { id: 'lastMonth', label: 'Прошлый месяц' },
  { id: 'thisQuarter', label: 'Текущий квартал' },
  { id: 'lastQuarter', label: 'Прошлый квартал' },
  { id: 'thisYear', label: 'Текущий год' },
  { id: 'lastYear', label: 'Прошлый год' },
];

const pad = (n: number) => String(n).padStart(2, '0');

export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromIsoDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** `2026-07-01` → `01.07.2026`. */
export function formatIsoDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
}

export function formatPeriod(period: Period): string {
  return `${formatIsoDate(period.from)} – ${formatIsoDate(period.to)}`;
}

/**
 * «Последние N дней» is N days including today. «Этот/Текущий …» runs to today,
 * not to the end of the month, quarter or year; «Прошлый …» is the whole previous
 * one. Quarters are calendar quarters. `new Date(y, m, d)` rolls out-of-range
 * months and days over, which handles every year and month boundary: month -1 is
 * last December, and day 0 is the previous month's last day.
 */
export function presetRange(preset: PresetId, today: Date): Period {
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  const day = (year: number, month: number, date: number) => toIsoDate(new Date(year, month, date));
  const todayIso = day(y, m, d);
  const quarterStart = m - (m % 3);

  switch (preset) {
    case 'last7':
      return { from: day(y, m, d - 6), to: todayIso };
    case 'last30':
      return { from: day(y, m, d - 29), to: todayIso };
    case 'thisMonth':
      return { from: day(y, m, 1), to: todayIso };
    case 'lastMonth':
      return { from: day(y, m - 1, 1), to: day(y, m, 0) };
    case 'thisQuarter':
      return { from: day(y, quarterStart, 1), to: todayIso };
    case 'lastQuarter':
      return { from: day(y, quarterStart - 3, 1), to: day(y, quarterStart, 0) };
    case 'thisYear':
      return { from: day(y, 0, 1), to: todayIso };
    case 'lastYear':
      return { from: day(y - 1, 0, 1), to: day(y - 1, 11, 31) };
  }
}

export function selectPreset(preset: PresetId, today: Date): SelectedPeriod {
  return { preset, ...presetRange(preset, today) };
}
