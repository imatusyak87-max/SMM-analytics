import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PostList } from './PostList';
import { formatPercent } from '../format';

const posts = [
  { id: 'p1', type: 'image', caption: 'Первый', publishedAt: '2026-09-01T10:00:00Z', thumbnailUrl: 'https://cdn/p1', permalink: 'https://t.me/c/1', views: 100, likes: 10, er: 1, erViews: 10 },
  { id: 'p2', type: 'video', caption: 'Второй', publishedAt: '2026-09-02T10:00:00Z', thumbnailUrl: 'https://cdn/p2', permalink: 'https://t.me/c/2', views: 900, likes: 9, er: 0.9, erViews: 1 },
];

describe('PostList', () => {
  it('shows the snippet, image and metrics for each post', () => {
    render(<PostList posts={posts} sort="views" onOpen={() => {}} />);
    const firstCaption = screen.getByText('Первый');
    expect(firstCaption).toBeInTheDocument();
    const firstCard = firstCaption.closest('button')!;
    expect(firstCard.querySelector('img')).toHaveAttribute('src', 'https://cdn/p1');
    expect(screen.getByText('900')).toBeInTheDocument();
  });

  it('marks each post image decorative, since its caption is already shown as visible text', () => {
    const { container } = render(<PostList posts={posts} sort="views" onOpen={() => {}} />);
    const images = container.querySelectorAll('img');
    expect(images.length).toBeGreaterThan(0);
    images.forEach((img) => expect(img).toHaveAttribute('alt', ''));
  });

  it('sorts by views by default, highest first', () => {
    render(<PostList posts={posts} sort="views" onOpen={() => {}} />);
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]).getByText('Второй')).toBeInTheDocument();
  });

  it('sorts by reactions when asked', () => {
    render(<PostList posts={posts} sort="reactions" onOpen={() => {}} />);
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]).getByText('Первый')).toBeInTheDocument();
  });

  it('sorts by ER against views when asked', () => {
    render(<PostList posts={posts} sort="er" onOpen={() => {}} />);
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]).getByText('Первый')).toBeInTheDocument();
  });

  it('sorts by date, newest first, when asked', () => {
    render(<PostList posts={posts} sort="date" onOpen={() => {}} />);
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]).getByText('Второй')).toBeInTheDocument();
  });

  it('opens the post that was clicked', () => {
    const onOpen = vi.fn();
    render(<PostList posts={posts} sort="views" onOpen={onOpen} />);
    fireEvent.click(screen.getByText('Первый'));
    expect(onOpen).toHaveBeenCalledWith(posts[0]);
  });

  it('focuses the card that was clicked, so the modal can return focus to it on close', () => {
    render(<PostList posts={posts} sort="views" onOpen={() => {}} />);
    const card = screen.getByText('Первый').closest('button')!;
    fireEvent.click(card);
    expect(card).toHaveFocus();
  });

  it('shows ER against views (erViews), not ER against followers (er), on each card', () => {
    render(<PostList posts={posts} sort="views" onOpen={() => {}} />);
    const items = screen.getAllByRole('listitem');
    const p1Item = items.find((item) => within(item).queryByText('Первый'));
    const p1 = within(p1Item!);
    expect(p1.getByText(formatPercent(posts[0].erViews))).toBeInTheDocument();
    expect(p1.queryByText(formatPercent(posts[0].er))).not.toBeInTheDocument();
  });

  it('explains an empty list instead of showing nothing', () => {
    render(<PostList posts={[]} sort="views" onOpen={() => {}} />);
    expect(screen.getByText(/Постов за этот период нет/)).toBeInTheDocument();
  });
});
