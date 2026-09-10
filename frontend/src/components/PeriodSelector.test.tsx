import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PeriodSelector } from './PeriodSelector';

describe('PeriodSelector', () => {
  it('offers 7, 30 and 90 days', () => {
    render(<PeriodSelector value={30} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: '7 дней' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '30 дней' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '90 дней' })).toBeInTheDocument();
  });

  it('marks the selected period', () => {
    render(<PeriodSelector value={30} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: '30 дней' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reports the chosen period in days', () => {
    const onChange = vi.fn();
    render(<PeriodSelector value={30} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '90 дней' }));
    expect(onChange).toHaveBeenCalledWith(90);
  });
});
