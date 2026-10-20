import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AddAccountDialog } from './AddAccountDialog';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));
const post = apiClient.post as any;

beforeEach(() => vi.clearAllMocks());

describe('AddAccountDialog', () => {
  it('adds the link to the project', async () => {
    post.mockImplementation((url: string) => (url === '/accounts/preview' ? new Promise(() => {}) : Promise.resolve({ data: { id: 'a1' } })));
    const onAdded = vi.fn();
    render(<AddAccountDialog projectId="p1" platform="telegram" onClose={vi.fn()} onAdded={onAdded} />);
    expect(screen.getByRole('dialog', { name: 'Добавить Telegram' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Telegram'), { target: { value: 'https://t.me/abcde' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/profiles/p1/accounts', { link: 'https://t.me/abcde' });
  });

  it('shows why the account could not be added', async () => {
    post.mockImplementation((url: string) =>
      url === '/accounts/preview' ? new Promise(() => {}) : Promise.reject({ response: { data: { message: 'В проекте уже есть Telegram' } } }));
    render(<AddAccountDialog projectId="p1" platform="telegram" onClose={vi.fn()} onAdded={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Telegram'), { target: { value: 'https://t.me/abcde' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    expect(await screen.findByText('В проекте уже есть Telegram')).toBeInTheDocument();
  });
});
