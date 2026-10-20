import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { LegacyProfileRedirect } from './LegacyProfileRedirect';

describe('LegacyProfileRedirect', () => {
  it('sends an old profile link to the project page', () => {
    render(
      <MemoryRouter initialEntries={['/profiles/p1']}>
        <Routes>
          <Route path="/profiles/:id" element={<LegacyProfileRedirect />} />
          <Route path="/projects/:id" element={<p>project page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('project page')).toBeInTheDocument();
  });
});
