import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { HomePage } from './HomePage';

describe('HomePage', () => {
  it('names the hub and links to all projects and the guide', () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: 'Единый центр отчетности FD Agency' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Все проекты' })).toHaveAttribute('href', '/projects');
    expect(screen.getByRole('link', { name: 'Как пользоваться' })).toHaveAttribute('href', '/guide');
  });
});
