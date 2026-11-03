import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { Layout } from './Layout';

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ logout: vi.fn() }) }));

describe('Layout', () => {
  it('shows the brand, the project and guide links, and no Compare', () => {
    render(<MemoryRouter><Layout><p>page</p></Layout></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'FD Agency' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Все проекты' })).toHaveAttribute('href', '/projects');
    expect(screen.getByRole('link', { name: 'Как пользоваться' })).toHaveAttribute('href', '/guide');
    expect(screen.queryByText('Compare')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeInTheDocument();
  });
});
