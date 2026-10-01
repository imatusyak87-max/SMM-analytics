import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PostTypeFilter } from './PostTypeFilter';

describe('PostTypeFilter', () => {
  it('offers only the types a Telegram post can be, in Russian', () => {
    render(<PostTypeFilter platform="telegram" value="all" onChange={() => {}} />);
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Все', 'Изображение', 'Видео', 'Кружочки', 'Текст']);
  });

  it('offers the Instagram types for an Instagram account', () => {
    render(<PostTypeFilter platform="instagram" value="all" onChange={() => {}} />);
    const options = screen.getAllByRole('option').map((o) => [o.getAttribute('value'), o.textContent]);
    expect(options).toEqual([
      ['all', 'Все'],
      ['post', 'Пост'],
      ['reel', 'Рилс'],
      ['carousel', 'Каруселька'],
    ]);
  });

  it('filters round video messages by their own type', () => {
    render(<PostTypeFilter platform="telegram" value="round_video" onChange={() => {}} />);
    expect(screen.getByRole('combobox')).toHaveDisplayValue('Кружочки');
  });
});
