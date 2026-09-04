import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AccountCard } from './AccountCard';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { delete: vi.fn() } }));

const account = { id: 'acc-1', platform: 'telegram', name: 'Chan', avatarUrl: null, type: 'public_no_access' };

function renderCard(onDeleted = vi.fn()) {
  render(
    <MemoryRouter>
      <AccountCard account={account} latestSnapshot={null} onDeleted={onDeleted} />
    </MemoryRouter>,
  );
  return onDeleted;
}

describe('AccountCard', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('deletes the account once the confirmation is accepted', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    (apiClient.delete as any).mockResolvedValue({});
    const onDeleted = renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Удалить аккаунт' }));

    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith('/accounts/acc-1'));
    expect(onDeleted).toHaveBeenCalled();
  });

  it('keeps the account when the confirmation is dismissed', () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    const onDeleted = renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Удалить аккаунт' }));

    expect(apiClient.delete).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
