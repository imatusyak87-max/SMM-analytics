import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Pagination } from './Pagination';
import { pageItems } from './pageItems';

const noop = () => {};

describe('pageItems', () => {
  it('lists every page when there are at most seven', () => {
    expect(pageItems(3, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageItems(1, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('shows the first and last page with the current one and its neighbours', () => {
    expect(pageItems(10, 20)).toEqual([1, 'gap', 9, 10, 11, 'gap', 20]);
  });

  it('drops a gap that would hide no pages', () => {
    expect(pageItems(1, 20)).toEqual([1, 2, 'gap', 20]);
    expect(pageItems(3, 20)).toEqual([1, 2, 3, 4, 'gap', 20]);
    expect(pageItems(20, 20)).toEqual([1, 'gap', 19, 20]);
  });
});

describe('Pagination', () => {
  it('shows one button per page and marks the current one', () => {
    render(<Pagination page={2} size={10} total={45} onPageChange={noop} onSizeChange={noop} />);
    expect(screen.getByRole('button', { name: 'Страница 2' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Страница 5' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Страница 6' })).not.toBeInTheDocument();
  });

  it('moves to the page clicked, and by one with the arrows', () => {
    const onPageChange = vi.fn();
    render(<Pagination page={2} size={10} total={45} onPageChange={onPageChange} onSizeChange={noop} />);

    fireEvent.click(screen.getByRole('button', { name: 'Страница 4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Следующая страница' }));
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущая страница' }));

    expect(onPageChange.mock.calls).toEqual([[4], [3], [1]]);
  });

  it('disables the arrows at either end', () => {
    render(<Pagination page={1} size={10} total={5} onPageChange={noop} onSizeChange={noop} />);
    expect(screen.getByRole('button', { name: 'Предыдущая страница' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Следующая страница' })).toBeDisabled();
  });

  it('offers 10, 25, 50 and 100 per page and reports the choice as a number', () => {
    const onSizeChange = vi.fn();
    render(<Pagination page={1} size={10} total={45} onPageChange={noop} onSizeChange={onSizeChange} />);

    const select = screen.getByLabelText('Показывать');
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual([
      '10',
      '25',
      '50',
      '100',
    ]);

    fireEvent.change(select, { target: { value: '50' } });
    expect(onSizeChange).toHaveBeenCalledWith(50);
  });
});
