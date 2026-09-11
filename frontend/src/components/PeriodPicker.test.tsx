import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PeriodPicker } from './PeriodPicker';
import { fromIsoDate, selectPreset, type SelectedPeriod } from '../periods';

const today = fromIsoDate('2026-09-11');
// 13.08.2026 – 11.09.2026, so the calendar opens on August and September 2026.
const last30 = selectPreset('last30', today);

function renderPicker(value: SelectedPeriod = last30) {
  const onChange = vi.fn();
  render(<PeriodPicker value={value} onChange={onChange} today={today} />);
  return onChange;
}

function openCalendar() {
  fireEvent.click(screen.getByRole('button', { name: /Выбрать даты/ }));
  return screen.getByRole('dialog', { name: 'Выбор периода' });
}

describe('PeriodPicker', () => {
  it('offers every preset and marks the active one', () => {
    renderPicker();
    const group = screen.getByRole('group', { name: 'Период' });
    expect(within(group).getAllByRole('button')).toHaveLength(8);
    expect(screen.getByRole('button', { name: 'Последние 30 дней' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Прошлый месяц' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('reports a preset as its date range', () => {
    const onChange = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Прошлый квартал' }));
    expect(onChange).toHaveBeenCalledWith({ preset: 'lastQuarter', from: '2026-04-01', to: '2026-06-30' });
  });

  it('shows the current range on the calendar button', () => {
    renderPicker();
    expect(screen.getByRole('button', { name: /Выбрать даты/ })).toHaveTextContent('13.08.2026 – 11.09.2026');
  });

  it('marks no preset active for a range picked on the calendar', () => {
    renderPicker({ preset: null, from: '2026-08-01', to: '2026-08-10' });
    const group = screen.getByRole('group', { name: 'Период' });
    within(group)
      .getAllByRole('button')
      .forEach((button) => expect(button).toHaveAttribute('aria-pressed', 'false'));
  });

  it('applies a range picked on the calendar only on «Применить»', () => {
    const onChange = renderPicker();
    const dialog = openCalendar();

    fireEvent.click(within(dialog).getAllByText('1')[0]);
    fireEvent.click(within(dialog).getAllByText('10')[0]);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Применить' }));
    expect(onChange).toHaveBeenCalledWith({ preset: null, from: '2026-08-01', to: '2026-08-10' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Выбрать даты/ })).toHaveFocus();
  });

  it('orders the range whichever day is clicked first', () => {
    const onChange = renderPicker();
    const dialog = openCalendar();

    fireEvent.click(within(dialog).getAllByText('20')[0]);
    fireEvent.click(within(dialog).getAllByText('5')[0]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Применить' }));

    expect(onChange).toHaveBeenCalledWith({ preset: null, from: '2026-08-05', to: '2026-08-20' });
  });

  it('applies a single picked day as a one-day period', () => {
    const onChange = renderPicker();
    const dialog = openCalendar();

    fireEvent.click(within(dialog).getAllByText('7')[0]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Применить' }));

    expect(onChange).toHaveBeenCalledWith({ preset: null, from: '2026-08-07', to: '2026-08-07' });
  });

  it('ignores a click on a future day', () => {
    const onChange = renderPicker();
    const dialog = openCalendar();

    // [1] is September; 12 September is the day after `today`. If the click were
    // accepted it would start the range there and 5 August would end it.
    fireEvent.click(within(dialog).getAllByText('12')[1]);
    fireEvent.click(within(dialog).getAllByText('5')[0]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Применить' }));

    expect(onChange).toHaveBeenCalledWith({ preset: null, from: '2026-08-05', to: '2026-08-05' });
  });

  it('lists the presets beside the calendar, marking the current one', () => {
    renderPicker();
    const dialog = openCalendar();
    const quick = within(dialog).getByRole('group', { name: 'Быстрый выбор' });

    expect(within(quick).getAllByRole('button')).toHaveLength(8);
    expect(within(quick).getByRole('button', { name: 'Последние 30 дней' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('previews a preset from the calendar and applies it only on «Применить»', () => {
    const onChange = renderPicker();
    const dialog = openCalendar();
    const quick = within(dialog).getByRole('group', { name: 'Быстрый выбор' });

    fireEvent.click(within(quick).getByRole('button', { name: 'Прошлый год' }));
    expect(onChange).not.toHaveBeenCalled();
    // The calendar jumps to the preset, so its end is in view.
    expect(within(dialog).getByText(/декабрь 2025/i)).toBeInTheDocument();
    expect(within(quick).getByRole('button', { name: 'Прошлый год' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Применить' }));
    expect(onChange).toHaveBeenCalledWith({ preset: 'lastYear', from: '2025-01-01', to: '2025-12-31' });
  });

  it('drops the preset once a day is picked by hand', () => {
    const onChange = renderPicker();
    const dialog = openCalendar();
    const quick = within(dialog).getByRole('group', { name: 'Быстрый выбор' });

    // August 2026 ends the range, so the calendar now shows July and August; [0] is 3 July.
    fireEvent.click(within(quick).getByRole('button', { name: 'Прошлый месяц' }));
    fireEvent.click(within(dialog).getAllByText('3')[0]);

    within(quick)
      .getAllByRole('button')
      .forEach((button) => expect(button).toHaveAttribute('aria-pressed', 'false'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Применить' }));
    expect(onChange).toHaveBeenCalledWith({ preset: null, from: '2026-07-03', to: '2026-07-03' });
  });

  it('shows the chosen range and its length while picking', () => {
    renderPicker();
    const dialog = openCalendar();

    expect(within(dialog).getByText('13.08.2026 – 11.09.2026')).toBeInTheDocument();
    expect(within(dialog).getByText('30 дней')).toBeInTheDocument();
  });

  it('closes on Escape without applying', () => {
    const onChange = renderPicker();
    const dialog = openCalendar();

    fireEvent.click(within(dialog).getAllByText('1')[0]);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Выбрать даты/ })).toHaveFocus();
  });

  it('closes on «Отмена» without applying', () => {
    const onChange = renderPicker();
    const dialog = openCalendar();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Выбрать даты/ })).toHaveFocus();
  });

  it('closes on an outside click without applying or moving focus', () => {
    const onChange = renderPicker();
    openCalendar();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Выбрать даты/ })).not.toHaveFocus();
  });
});
