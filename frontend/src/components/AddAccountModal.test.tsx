import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AddAccountModal } from './AddAccountModal';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { post: vi.fn() } }));

describe('AddAccountModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('posts the pasted link and reports success to its parent', async () => {
    (apiClient.post as any).mockResolvedValue({ data: { id: 'acc-1' } });
    const onCreated = vi.fn();
    render(<AddAccountModal onClose={vi.fn()} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText('Ссылка на аккаунт'), {
      target: { value: 'https://t.me/somechannel' },
    });
    fireEvent.click(screen.getByText('Добавить'));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith('/accounts/from-link', { link: 'https://t.me/somechannel' }),
    );
    expect(onCreated).toHaveBeenCalled();
  });

  it('shows the server error and stays open when the link is rejected', async () => {
    (apiClient.post as any).mockRejectedValue({
      response: { data: { message: 'vk is not supported yet.' } },
    });
    const onCreated = vi.fn();
    render(<AddAccountModal onClose={vi.fn()} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText('Ссылка на аккаунт'), { target: { value: 'https://vk.com/somegroup' } });
    fireEvent.click(screen.getByText('Добавить'));

    await waitFor(() => expect(screen.getByText('vk is not supported yet.')).toBeInTheDocument());
    expect(onCreated).not.toHaveBeenCalled();
  });
});
