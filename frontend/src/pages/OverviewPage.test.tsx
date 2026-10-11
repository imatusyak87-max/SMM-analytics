import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OverviewPage } from './OverviewPage';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

const NO_STATUS = { connected: false, needsReconnect: false, username: null };

/** Routes apiClient.get by URL; the Facebook status defaults to "nothing to show". */
function mockGets(overview: unknown = [], status: unknown = NO_STATUS) {
  (apiClient.get as any).mockImplementation((url: string) => {
    if (url === '/instagram/discovery/status') {
      return status instanceof Error ? Promise.reject(status) : Promise.resolve({ data: status });
    }
    return Promise.resolve({ data: overview });
  });
}

const overviewCalls = () => (apiClient.get as any).mock.calls.filter((c: unknown[]) => c[0] === '/stats/overview').length;

describe('OverviewPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens the add-account form and reloads accounts after one is created', async () => {
    mockGets();
    (apiClient.post as any)
      .mockResolvedValueOnce({
        data: {
          platform: 'telegram',
          externalId: '@somechannel',
          name: 'Some Channel',
          followersCount: 10,
          avatarDataUri: null,
        },
      })
      .mockResolvedValueOnce({ data: { id: 'acc-1' } });

    render(<MemoryRouter><OverviewPage /></MemoryRouter>);
    await waitFor(() => expect(overviewCalls()).toBe(1));

    fireEvent.click(screen.getByText('Добавить аккаунт'));
    fireEvent.change(screen.getByLabelText('Ссылка на аккаунт'), {
      target: { value: 'https://t.me/somechannel' },
    });
    fireEvent.click(await screen.findByText('Добавить'));

    await waitFor(() => expect(overviewCalls()).toBe(2));
    expect(screen.queryByLabelText('Ссылка на аккаунт')).not.toBeInTheDocument();
  });

  it('renders a card per account with followers and ER', async () => {
    mockGets([
      { account: { id: 'acc-1', platform: 'telegram', name: 'Chan', avatarUrl: null, type: 'own' },
        latestSnapshot: { followersCount: 1234, avgEr: 3.2 } },
    ]);

    render(<MemoryRouter><OverviewPage /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText('Chan')).toBeInTheDocument());
    expect(screen.getByText('1234')).toBeInTheDocument();
  });

  it('reopens the add dialog when the Facebook login sends the user back', async () => {
    mockGets();
    render(<MemoryRouter initialEntries={['/?add=competitor']}><OverviewPage /></MemoryRouter>);

    expect(await screen.findByRole('dialog', { name: 'Добавьте аккаунт' })).toBeInTheDocument();
  });

  it('shows the error the Facebook login came back with', async () => {
    mockGets();
    const entry = `/?add=competitor&discoveryError=${encodeURIComponent('Вход через Facebook отменён')}`;
    render(<MemoryRouter initialEntries={[entry]}><OverviewPage /></MemoryRouter>);

    expect(await screen.findByRole('alert')).toHaveTextContent('Вход через Facebook отменён');
  });

  it('does not open the dialog on a plain visit', async () => {
    mockGets();
    render(<MemoryRouter><OverviewPage /></MemoryRouter>);

    await screen.findByText(/No accounts yet|Loading/);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('forgets the Facebook login error once the dialog is closed', async () => {
    mockGets();
    const entry = `/?add=competitor&discoveryError=${encodeURIComponent('Вход через Facebook отменён')}`;
    render(<MemoryRouter initialEntries={[entry]}><OverviewPage /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Вход через Facebook отменён');

    fireEvent.click(screen.getByText('Отмена'));
    fireEvent.click(screen.getByText('Добавить аккаунт'));

    expect(await screen.findByRole('dialog', { name: 'Добавьте аккаунт' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  describe('expired Facebook connection banner', () => {
    const EXPIRED = { connected: true, needsReconnect: true, username: 'fdagency' };
    const BANNER = 'Доступ к Facebook истёк — конкуренты из Instagram не обновляются.';

    it('is shown when connected and the access has expired', async () => {
      mockGets([], EXPIRED);
      render(<MemoryRouter><OverviewPage /></MemoryRouter>);

      expect(await screen.findByRole('alert')).toHaveTextContent(BANNER);
      expect(screen.getByRole('button', { name: 'Переподключить Facebook' })).toBeInTheDocument();
    });

    it.each([
      ['not connected', NO_STATUS],
      ['still valid', { connected: true, needsReconnect: false, username: 'fdagency' }],
      ['the status request fails', new Error('boom')],
    ])('is hidden when %s', async (_name, status) => {
      mockGets([], status);
      render(<MemoryRouter><OverviewPage /></MemoryRouter>);

      await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/instagram/discovery/status'));
      await screen.findByText(/No accounts yet/);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('sends the browser to the Facebook login on click', async () => {
      const originalLocation = window.location;
      mockGets([], EXPIRED);
      (apiClient.get as any).mockImplementation((url: string) =>
        url === '/instagram/discovery/connect'
          ? Promise.resolve({ data: { redirectUrl: 'https://www.facebook.com/dialog' } })
          : Promise.resolve({ data: url === '/instagram/discovery/status' ? EXPIRED : [] }),
      );
      delete (window as any).location;
      (window as any).location = { href: '' };
      try {
        render(<MemoryRouter><OverviewPage /></MemoryRouter>);
        fireEvent.click(await screen.findByRole('button', { name: 'Переподключить Facebook' }));

        await waitFor(() => expect(window.location.href).toBe('https://www.facebook.com/dialog'));
      } finally {
        (window as any).location = originalLocation;
      }
    });

    it('shows the server message when the login cannot be started', async () => {
      (apiClient.get as any).mockImplementation((url: string) => {
        if (url === '/instagram/discovery/connect') return Promise.reject({ response: { data: { message: 'Facebook не настроен' } } });
        return Promise.resolve({ data: url === '/instagram/discovery/status' ? EXPIRED : [] });
      });
      render(<MemoryRouter><OverviewPage /></MemoryRouter>);

      fireEvent.click(await screen.findByRole('button', { name: 'Переподключить Facebook' }));

      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Facebook не настроен'));
      expect(screen.getByRole('button', { name: 'Переподключить Facebook' })).toBeEnabled();
    });
  });
});
