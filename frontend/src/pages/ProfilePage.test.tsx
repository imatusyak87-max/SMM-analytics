import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProfilePage } from './ProfilePage';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

const get = apiClient.get as any;
const patch = apiClient.patch as any;
const del = apiClient.delete as any;

const item = (id: string, name: string, platform: string, followers: number) => ({
  account: { id, platform, name, avatarUrl: null, type: 'own' },
  latestSnapshot: { followersCount: followers, avgEr: 1.5 },
});

const twoAccounts = {
  id: 'p1', name: 'Coffee Lab', totalFollowers: 1500,
  accounts: [item('acc-ig', 'coffee_ig', 'instagram', 1000), item('acc-tg', 'Coffee TG', 'telegram', 500)],
};

function mockProfile(data: unknown = twoAccounts) {
  get.mockImplementation((url: string) =>
    url === '/profiles/p1' ? Promise.resolve({ data }) : Promise.resolve({ data: new Blob() }),
  );
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/profiles/p1']}>
      <Routes>
        <Route path="/profiles/:id" element={<ProfilePage />} />
        <Route path="/" element={<p>Overview page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProfilePage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the profile and a card for each of its accounts', async () => {
    mockProfile();
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Coffee Lab' })).toBeInTheDocument();
    expect(screen.getAllByTestId('account-card')).toHaveLength(2);
    expect(screen.getByText('coffee_ig')).toBeInTheDocument();
    expect(screen.getByText('Coffee TG')).toBeInTheDocument();
  });

  it('renames the profile on Enter', async () => {
    mockProfile();
    patch.mockResolvedValue({ data: {} });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Переименовать' }));
    const input = screen.getByLabelText('Название профиля');
    fireEvent.change(input, { target: { value: 'Coffee Lab Moscow' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(patch).toHaveBeenCalledWith('/profiles/p1', { name: 'Coffee Lab Moscow' }));
  });

  it('cancels a rename on Escape', async () => {
    mockProfile();
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Переименовать' }));
    const input = screen.getByLabelText('Название профиля');
    fireEvent.change(input, { target: { value: 'Something else' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(await screen.findByRole('heading', { name: 'Coffee Lab' })).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });

  it('shows why a rename failed', async () => {
    mockProfile();
    patch.mockRejectedValue({ response: { data: { message: 'Название профиля не может быть пустым' } } });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Переименовать' }));
    const input = screen.getByLabelText('Название профиля');
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByRole('alert')).toHaveTextContent('Название профиля не может быть пустым');
  });

  it('joins several validation messages into one line', async () => {
    mockProfile();
    patch.mockRejectedValue({ response: { data: { message: ['Первое', 'Второе'] } } });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Переименовать' }));
    const input = screen.getByLabelText('Название профиля');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByRole('alert')).toHaveTextContent('Первое, Второе');
  });

  it('caps the name input at 100 characters', async () => {
    mockProfile();
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Переименовать' }));
    expect(screen.getByLabelText('Название профиля')).toHaveAttribute('maxlength', '100');
  });

  it('says so when the profile does not exist', async () => {
    get.mockRejectedValue({ response: { status: 404 } });
    renderPage();

    expect(await screen.findByText('Профиль не найден')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Вернуться к обзору' })).toHaveAttribute('href', '/');
  });

  it('goes back to Overview after deleting its last account', async () => {
    mockProfile({ ...twoAccounts, accounts: [twoAccounts.accounts[0]] });
    del.mockResolvedValue({});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Удалить аккаунт' }));

    expect(await screen.findByText('Overview page')).toBeInTheDocument();
  });
});
