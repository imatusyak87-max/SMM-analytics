import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PostTable } from './PostTable';
import { formatPercent } from '../format';

const posts = [
  {
    id: 'p1', type: 'image', caption: 'Первый', publishedAt: '2026-06-30T15:50:00Z',
    thumbnailUrl: 'https://cdn/p1', permalink: 'https://t.me/c/1',
    views: 266, likes: 7, er: 0.4, erViews: 2.6,
  },
  {
    id: 'p2', type: 'post', caption: null, publishedAt: '2026-06-26T14:16:00Z',
    thumbnailUrl: null, permalink: 'https://t.me/c/2',
    views: null, likes: 0, er: null, erViews: null,
  },
];

const noop = () => {};
// getAllByRole('row')[0] is the header row.
const bodyRow = (index: number) => screen.getAllByRole('row')[index + 1];

describe('PostTable', () => {
  it('shows the total number of posts', () => {
    render(<PostTable posts={posts} total={37} onOpen={noop} />);
    expect(screen.getByText('Всего постов: 37')).toBeInTheDocument();
  });

  it('has a column for every metric', () => {
    render(<PostTable posts={posts} total={2} onOpen={noop} />);
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Дата и время',
      'Пост',
      'Просмотры',
      'Реакции',
      'ERR',
      'ER',
    ]);
  });

  it("shows each post's date and time, text and metrics in its row", () => {
    render(<PostTable posts={posts} total={2} onOpen={noop} />);
    const cells = within(bodyRow(0)).getAllByRole('cell').map((cell) => cell.textContent);
    expect(cells).toEqual(['30.06.2026, 15:50', 'Первый', '266', '7', formatPercent(2.6), formatPercent(0.4)]);
  });

  it('shows a dash for unknown metrics and says when a post has no text', () => {
    render(<PostTable posts={posts} total={2} onOpen={noop} />);
    const row = within(bodyRow(1));
    expect(row.getByText('Без текста')).toBeInTheDocument();
    expect(row.getAllByText('—')).toHaveLength(3);
  });

  it('opens the post whose row is clicked, and focuses its button for the modal to return to', () => {
    const onOpen = vi.fn();
    render(<PostTable posts={posts} total={2} onOpen={onOpen} />);
    const row = within(bodyRow(0));

    fireEvent.click(row.getByText('266'));

    expect(onOpen).toHaveBeenCalledWith(posts[0]);
    expect(row.getByRole('button')).toHaveFocus();
  });

  it('opens the post exactly once when its button is activated', () => {
    const onOpen = vi.fn();
    render(<PostTable posts={posts} total={2} onOpen={onOpen} />);

    fireEvent.click(within(bodyRow(0)).getByRole('button'));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('marks thumbnails decorative, since the text beside them is visible', () => {
    const { container } = render(<PostTable posts={posts} total={2} onOpen={noop} />);
    container.querySelectorAll('img').forEach((img) => expect(img).toHaveAttribute('alt', ''));
  });
});
