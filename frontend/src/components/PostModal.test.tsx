import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PostModal } from './PostModal';
import { formatPercent } from '../format';

const post = {
  id: 'p1', type: 'image', caption: 'Полный текст поста',
  publishedAt: '2026-09-02T12:30:45Z', thumbnailUrl: 'https://cdn/p1',
  permalink: 'https://t.me/testchannel/102', views: 12300, likes: 1248, er: 1.2, erViews: 10.1,
};

const digits = (expected: string) => (text: string) => text.replace(/\s/g, '') === expected;

describe('PostModal', () => {
  it('renders nothing when no post is open', () => {
    const { container } = render(<PostModal post={null} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the full text, image and every metric', () => {
    render(<PostModal post={post} onClose={() => {}} />);
    expect(screen.getByText('Полный текст поста')).toBeInTheDocument();
    expect(screen.getByAltText('Полный текст поста')).toHaveAttribute('src', 'https://cdn/p1');
    expect(screen.getByText(digits('12300'))).toBeInTheDocument();
    expect(screen.getByText(digits('1248'))).toBeInTheDocument();
  });

  it('shows the date AND the time of publication', () => {
    render(<PostModal post={post} onClose={() => {}} />);
    expect(screen.getByText(/02\.09\.2026/)).toBeInTheDocument();
    expect(screen.getByText(/12:30/)).toBeInTheDocument();
  });

  it('links out to the post on Telegram', () => {
    render(<PostModal post={post} onClose={() => {}} />);
    expect(screen.getByRole('link', { name: /Открыть в Telegram/ })).toHaveAttribute(
      'href',
      'https://t.me/testchannel/102',
    );
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<PostModal post={post} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when the backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<PostModal post={post} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('post-modal-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows each engagement figure next to its own label, not swapped', () => {
    render(<PostModal post={post} onClose={() => {}} />);
    const errTerm = screen.getByText('ERR к просмотрам');
    const errRow = errTerm.closest('div') ?? errTerm.parentElement!;
    expect(within(errRow).getByText(formatPercent(post.erViews))).toBeInTheDocument();
    expect(within(errRow).queryByText(formatPercent(post.er))).not.toBeInTheDocument();

    const erTerm = screen.getByText('ER к подписчикам');
    const erRow = erTerm.closest('div') ?? erTerm.parentElement!;
    expect(within(erRow).getByText(formatPercent(post.er))).toBeInTheDocument();
    expect(within(erRow).queryByText(formatPercent(post.erViews))).not.toBeInTheDocument();
    expect(within(erRow).getByText('по текущему числу подписчиков')).toBeInTheDocument();
  });
});
