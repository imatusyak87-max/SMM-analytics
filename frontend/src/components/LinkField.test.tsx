import { render, screen, fireEvent, act } from '@testing-library/react';
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LinkField } from './LinkField';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));
const post = apiClient.post as any;

function Harness({ platform = 'telegram' as 'telegram' | 'instagram' }) {
  const [value, setValue] = useState('');
  return <LinkField id="f" platform={platform} value={value} onChange={setValue} />;
}

async function type(text: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
  await act(async () => { vi.advanceTimersByTime(700); });
}

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

describe('LinkField', () => {
  it('labels the field with its network and shows the link format', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Telegram')).toBeInTheDocument();
    expect(screen.getByText('Например: https://t.me/channel')).toBeInTheDocument();
  });

  it('shows the account it found', async () => {
    post.mockResolvedValue({ data: { platform: 'telegram', externalId: '@chan', name: 'Канал', followersCount: 1200, avatarDataUri: null, alreadyAdded: false } });
    render(<Harness />);
    await type('https://t.me/chan');
    expect(post).toHaveBeenCalledWith('/accounts/preview', { link: 'https://t.me/chan' });
    expect(screen.getByText('Канал')).toBeInTheDocument();
  });

  it('says when the link belongs to another network', async () => {
    post.mockResolvedValue({ data: { platform: 'instagram', externalId: '@b', name: 'B', followersCount: 1, avatarDataUri: null, alreadyAdded: false } });
    render(<Harness />);
    await type('https://instagram.com/b');
    expect(screen.getByRole('alert')).toHaveTextContent('Это ссылка не на Telegram');
  });

  it('shows the server error for a link it cannot find', async () => {
    post.mockRejectedValue({ response: { data: { message: 'Канал не найден' } } });
    render(<Harness />);
    await type('https://t.me/nothere');
    expect(screen.getByRole('alert')).toHaveTextContent('Канал не найден');
  });

  it('offers the Facebook login when Instagram lookups need it', async () => {
    post.mockRejectedValue({ response: { data: { code: 'instagram_discovery_not_connected', message: 'x' } } });
    render(<Harness platform="instagram" />);
    await type('https://instagram.com/brand');
    expect(screen.getByRole('button', { name: 'Подключить Facebook' })).toBeInTheDocument();
  });
});
