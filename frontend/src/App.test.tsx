import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from './App';

describe('App', () => {
  it('renders the overview placeholder at /', () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(screen.getByText('overview')).toBeInTheDocument();
  });
});
