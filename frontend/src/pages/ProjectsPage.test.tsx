import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectsPage } from './ProjectsPage';
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

const overviewCalls = () => (apiClient.get as any).mock.calls.filter((c: unknown[]) => c[0] === '/profiles').length;

describe('ProjectsPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens the add-project form from the add button', async () => {
    mockGets();
    render(<MemoryRouter><ProjectsPage /></MemoryRouter>);
    await waitFor(() => expect(overviewCalls()).toBe(1));

    fireEvent.click(screen.getByText('Добавить проект'));
    expect(screen.getByRole('dialog', { name: 'Добавить проект' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('Отмена'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('has the «Все проекты» heading', async () => {
    mockGets();
    render(<MemoryRouter><ProjectsPage /></MemoryRouter>);
    expect(await screen.findByRole('heading', { level: 1, name: 'Все проекты' })).toBeInTheDocument();
  });

  it('says so when projects cannot be loaded', async () => {
    (apiClient.get as any).mockImplementation((url: string) =>
      url === '/profiles' ? Promise.reject(new Error('x')) : Promise.resolve({ data: NO_STATUS }));
    render(<MemoryRouter><ProjectsPage /></MemoryRouter>);
    expect(await screen.findByText('Не удалось загрузить проекты. Попробуйте позже.')).toBeInTheDocument();
  });

  it('lists a project that has no accounts yet', async () => {
    mockGets([{ id: 'p1', name: 'Мезопроф', totalFollowers: null, accounts: [] }]);
    render(<MemoryRouter><ProjectsPage /></MemoryRouter>);
    expect(await screen.findByText('Мезопроф')).toBeInTheDocument();
    expect(screen.getByText('Аккаунты не добавлены')).toBeInTheDocument();
  });

  it('renders a card per profile with its total followers', async () => {
    mockGets([
      {
        id: 'p1', name: 'Coffee Lab', totalFollowers: 1234,
        accounts: [
          { account: { id: 'acc-1', platform: 'telegram', name: 'Chan', avatarUrl: null, type: 'own' },
            latestSnapshot: { followersCount: 1000, avgEr: 3.2 } },
          { account: { id: 'acc-2', platform: 'instagram', name: 'chan_ig', avatarUrl: null, type: 'own' },
            latestSnapshot: { followersCount: 234, avgEr: 1.1 } },
        ],
      },
    ]);

    render(<MemoryRouter><ProjectsPage /></MemoryRouter>);

    expect(await screen.findByText('Coffee Lab')).toBeInTheDocument();
    expect(screen.getAllByTestId('profile-card')).toHaveLength(1);
    expect(screen.getByText((text) => text.replace(/\s/g, '') === '1234')).toBeInTheDocument();
    expect(screen.queryByText('Chan')).not.toBeInTheDocument();
  });

  it('reopens the add dialog when the Facebook login sends the user back', async () => {
    mockGets();
    render(<MemoryRouter initialEntries={['/projects?add=project']}><ProjectsPage /></MemoryRouter>);

    expect(await screen.findByRole('dialog', { name: 'Добавить проект' })).toBeInTheDocument();
  });

  it('shows the error the Facebook login came back with', async () => {
    mockGets();
    const entry = `/projects?add=project&discoveryError=${encodeURIComponent('Вход через Facebook отменён')}`;
    render(<MemoryRouter initialEntries={[entry]}><ProjectsPage /></MemoryRouter>);

    expect(await screen.findByRole('alert')).toHaveTextContent('Вход через Facebook отменён');
  });

  it('does not open the dialog on a plain visit', async () => {
    mockGets();
    render(<MemoryRouter><ProjectsPage /></MemoryRouter>);

    await screen.findByText(/Пока нет ни одного проекта|Загрузка/);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('forgets the Facebook login error once the dialog is closed', async () => {
    mockGets();
    const entry = `/projects?add=project&discoveryError=${encodeURIComponent('Вход через Facebook отменён')}`;
    render(<MemoryRouter initialEntries={[entry]}><ProjectsPage /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Вход через Facebook отменён');

    fireEvent.click(screen.getByText('Отмена'));
    fireEvent.click(screen.getByText('Добавить проект'));

    expect(await screen.findByRole('dialog', { name: 'Добавить проект' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  describe('expired Facebook connection banner', () => {
    const EXPIRED = { connected: true, needsReconnect: true, username: 'fdagency' };
    const BANNER = 'Доступ к Facebook истёк — конкуренты из Instagram не обновляются.';

    it('is shown when connected and the access has expired', async () => {
      mockGets([], EXPIRED);
      render(<MemoryRouter><ProjectsPage /></MemoryRouter>);

      expect(await screen.findByRole('alert')).toHaveTextContent(BANNER);
      expect(screen.getByRole('button', { name: 'Переподключить Facebook' })).toBeInTheDocument();
    });

    it.each([
      ['not connected', NO_STATUS],
      ['still valid', { connected: true, needsReconnect: false, username: 'fdagency' }],
      ['the status request fails', new Error('boom')],
    ])('is hidden when %s', async (_name, status) => {
      mockGets([], status);
      render(<MemoryRouter><ProjectsPage /></MemoryRouter>);

      await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/instagram/discovery/status'));
      await screen.findByText(/Пока нет ни одного проекта/);
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
        render(<MemoryRouter><ProjectsPage /></MemoryRouter>);
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
      render(<MemoryRouter><ProjectsPage /></MemoryRouter>);

      fireEvent.click(await screen.findByRole('button', { name: 'Переподключить Facebook' }));

      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Facebook не настроен'));
      expect(screen.getByRole('button', { name: 'Переподключить Facebook' })).toBeEnabled();
    });
  });
});
