import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ViewModeSwitch } from './ViewModeSwitch';

describe('ViewModeSwitch', () => {
  it('shows the own profile as current and competitors as coming soon', () => {
    render(<ViewModeSwitch />);
    expect(screen.getByRole('button', { name: 'Свой профиль' })).toHaveAttribute('aria-pressed', 'true');
    const competitors = screen.getByRole('button', { name: /Конкуренты/ });
    expect(competitors).toBeDisabled();
    expect(competitors).toHaveTextContent('Скоро');
  });
});
