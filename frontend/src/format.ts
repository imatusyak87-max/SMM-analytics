/**
 * Shared number formatters for the account detail page (stat tiles, post grid,
 * post modal): ru-RU counts, one decimal plus `%` for ER, `—` for null.
 */
const EMPTY = '—';
const wholeNumber = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function formatCount(value: number | null): string {
  return value == null ? EMPTY : wholeNumber.format(value);
}

export function formatPercent(value: number | null): string {
  return value == null ? EMPTY : `${oneDecimal.format(value)}%`;
}
