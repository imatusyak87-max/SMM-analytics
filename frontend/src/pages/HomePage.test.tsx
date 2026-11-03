import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { HomePage } from './HomePage';

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname + location.search}</span>;
}

describe('HomePage', () => {
  it('names the hub and links to all projects and the guide', () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: 'Единый центр отчетности FD Agency' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Все проекты' })).toHaveAttribute('href', '/projects');
    expect(screen.getByRole('link', { name: 'Как пользоваться' })).toHaveAttribute('href', '/guide');
  });

  it('shows an Instagram login error it was sent back with, then clears the address', async () => {
    render(
      <MemoryRouter initialEntries={['/?instagramError=' + encodeURIComponent('Аккаунт больше не существует')]}>
        <Routes><Route path="/" element={<><HomePage /><LocationProbe /></>} /></Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Аккаунт больше не существует');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
  });
});
