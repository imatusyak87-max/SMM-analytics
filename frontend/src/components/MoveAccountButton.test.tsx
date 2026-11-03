import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MoveAccountButton } from './MoveAccountButton';
import { apiClient } from '../api/client';

vi.mock('../api/client', () => ({ apiClient: { get: vi.fn(), patch: vi.fn() } }));
const get = apiClient.get as any;
const patch = apiClient.patch as any;

const projects = [
  { id: 'prof-1', name: 'Coffee Lab', totalFollowers: 1, accounts: [{ account: { platform: 'telegram' } }] },
  { id: 'prof-2', name: 'Мезопроф', totalFollowers: 1, accounts: [{ account: { platform: 'instagram' } }] },
];

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: projects });
});

describe('MoveAccountButton', () => {
  it('lists the other projects with their networks', async () => {
    render(<MoveAccountButton accountId="acc-1" currentProjectId="prof-1" onMoved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Перенести…' }));
    expect(await screen.findByRole('menuitem', { name: 'Мезопроф (instagram)' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Coffee Lab/ })).not.toBeInTheDocument();
  });

  it('moves the account and reports back', async () => {
    patch.mockResolvedValue({ data: { profileId: 'prof-2' } });
    const onMoved = vi.fn();
    render(<MoveAccountButton accountId="acc-1" currentProjectId="prof-1" onMoved={onMoved} />);
    fireEvent.click(screen.getByRole('button', { name: 'Перенести…' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Мезопроф (instagram)' }));
    await waitFor(() => expect(onMoved).toHaveBeenCalled());
    expect(patch).toHaveBeenCalledWith('/accounts/acc-1/profile', { profileId: 'prof-2' });
  });

  it('shows why a move was refused', async () => {
    patch.mockRejectedValue({ response: { data: { message: 'В проекте уже есть Instagram' } } });
    render(<MoveAccountButton accountId="acc-1" currentProjectId="prof-1" onMoved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Перенести…' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Мезопроф (instagram)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('В проекте уже есть Instagram');
  });

  it('says so when there is nowhere to move', async () => {
    get.mockResolvedValue({ data: [projects[0]] });
    render(<MoveAccountButton accountId="acc-1" currentProjectId="prof-1" onMoved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Перенести…' }));
    expect(await screen.findByText('Других проектов нет')).toBeInTheDocument();
  });

  it('closes on Escape and on an outside click', async () => {
    render(<MoveAccountButton accountId="acc-1" currentProjectId="prof-1" onMoved={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Перенести…' });
    fireEvent.click(trigger);
    await screen.findByRole('menuitem', { name: 'Мезопроф (instagram)' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    await screen.findByRole('menu');
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
