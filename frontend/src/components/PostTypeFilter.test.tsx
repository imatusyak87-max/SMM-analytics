import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PostTypeFilter } from './PostTypeFilter';

describe('PostTypeFilter', () => {
  it('offers only the types a Telegram post can be, in Russian', () => {
    render(<PostTypeFilter value="all" onChange={() => {}} />);
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Все', 'Изображение', 'Видео', 'Кружочки', 'Текст']);
  });

  it('filters round video messages by their own type', () => {
    render(<PostTypeFilter value="round_video" onChange={() => {}} />);
    expect(screen.getByRole('combobox')).toHaveDisplayValue('Кружочки');
  });
});
