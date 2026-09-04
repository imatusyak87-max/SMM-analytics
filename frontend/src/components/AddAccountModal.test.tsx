import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AddAccountModal } from './AddAccountModal';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { post: vi.fn() } }));

const previewData = {
  platform: 'telegram',
  externalId: '@somechannel',
  name: 'Some Channel',
  followersCount: 4321,
  avatarDataUri: 'data:image/jpeg;base64,aW1n',
};

function pasteLink(value = 'https://t.me/somechannel') {
  fireEvent.change(screen.getByLabelText('Ссылка на аккаунт'), { target: { value } });
}

describe('AddAccountModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the resolved channel after a link is pasted', async () => {
    (apiClient.post as any).mockResolvedValue({ data: previewData });
    render(<AddAccountModal onClose={vi.fn()} onCreated={vi.fn()} />);

    pasteLink();

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith('/accounts/preview', {
        link: 'https://t.me/somechannel',
      }),
    );
    expect(await screen.findByText('Some Channel')).toBeInTheDocument();
    expect(screen.getByText('4321')).toBeInTheDocument();
    expect(screen.getByAltText('Some Channel')).toHaveAttribute('src', previewData.avatarDataUri);
  });

  it('adds the previewed channel and reports success to its parent', async () => {
    (apiClient.post as any)
      .mockResolvedValueOnce({ data: previewData })
      .mockResolvedValueOnce({ data: { id: 'acc-1' } });
    const onCreated = vi.fn();
    render(<AddAccountModal onClose={vi.fn()} onCreated={onCreated} />);

    pasteLink();
    fireEvent.click(await screen.findByText('Добавить'));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenLastCalledWith('/accounts/from-link', {
        link: 'https://t.me/somechannel',
      }),
    );
    expect(onCreated).toHaveBeenCalled();
  });

  it('offers nothing to add while the link cannot be resolved', async () => {
    (apiClient.post as any).mockRejectedValue({
      response: { data: { message: 'vk is not supported yet.' } },
    });
    render(<AddAccountModal onClose={vi.fn()} onCreated={vi.fn()} />);

    pasteLink('https://vk.com/somegroup');

    expect(await screen.findByText('vk is not supported yet.')).toBeInTheDocument();
    expect(screen.queryByText('Добавить')).not.toBeInTheDocument();
  });
});
