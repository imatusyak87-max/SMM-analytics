import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AddAccountModal } from './AddAccountModal';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { post: vi.fn(), get: vi.fn() } }));

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

  it('warns and blocks Добавить when the channel is already added', async () => {
    (apiClient.post as any).mockResolvedValue({ data: { ...previewData, alreadyAdded: true } });
    render(<AddAccountModal onClose={vi.fn()} onCreated={vi.fn()} />);

    pasteLink();

    expect(await screen.findByText('Этот аккаунт уже добавлен')).toBeInTheDocument();
    expect(screen.getByText('Добавить')).toBeDisabled();
  });

  it('does not send an add request for an already added channel', async () => {
    (apiClient.post as any).mockResolvedValue({ data: { ...previewData, alreadyAdded: true } });
    render(<AddAccountModal onClose={vi.fn()} onCreated={vi.fn()} />);

    pasteLink();
    fireEvent.click(await screen.findByText('Добавить'));

    await waitFor(() => expect(screen.getByText('Этот аккаунт уже добавлен')).toBeInTheDocument());
    expect(apiClient.post).not.toHaveBeenCalledWith('/accounts/from-link', expect.anything());
  });

  it('leaves Добавить usable for a channel that is not yet added', async () => {
    (apiClient.post as any).mockResolvedValue({ data: { ...previewData, alreadyAdded: false } });
    render(<AddAccountModal onClose={vi.fn()} onCreated={vi.fn()} />);

    pasteLink();

    expect(await screen.findByText('Добавить')).toBeEnabled();
    expect(screen.queryByText('Этот аккаунт уже добавлен')).not.toBeInTheDocument();
  });
});

describe('Instagram tab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a type choice and one button instead of the link field', async () => {
    render(<AddAccountModal onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Instagram' }));

    expect(screen.queryByLabelText('Ссылка на аккаунт')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Свой аккаунт')).toBeInTheDocument();
    expect(screen.getByLabelText('Аккаунт клиента')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Подключить' })).toBeInTheDocument();
  });

  it('navigates to the URL the backend returns, for the selected type', async () => {
    const originalLocation = window.location;
    (apiClient.get as any).mockResolvedValue({ data: { redirectUrl: 'https://www.instagram.com/oauth/authorize?state=abc' } });
    delete (window as any).location;
    (window as any).location = { href: '' };
    try {
      render(<AddAccountModal onClose={vi.fn()} onCreated={vi.fn()} />);

      fireEvent.click(screen.getByRole('tab', { name: 'Instagram' }));
      fireEvent.click(screen.getByLabelText('Аккаунт клиента'));
      fireEvent.click(screen.getByRole('button', { name: 'Подключить' }));

      await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/accounts/instagram/connect', { params: { type: 'client' } }));
      await waitFor(() => expect(window.location.href).toBe('https://www.instagram.com/oauth/authorize?state=abc'));
    } finally {
      (window as any).location = originalLocation;
    }
  });

  it('shows an error and stays on the modal when the backend call fails', async () => {
    (apiClient.get as any).mockRejectedValue({ response: { data: { message: 'Не удалось начать подключение' } } });
    render(<AddAccountModal onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Instagram' }));
    fireEvent.click(screen.getByRole('button', { name: 'Подключить' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось начать подключение');
  });

  it('switching back to the Telegram tab restores the link field', async () => {
    render(<AddAccountModal onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Instagram' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Telegram' }));

    expect(screen.getByLabelText('Ссылка на аккаунт')).toBeInTheDocument();
  });
});
