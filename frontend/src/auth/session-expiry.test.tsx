import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AxiosError, type AxiosAdapter } from 'axios';
import App from '../App';
import { apiClient } from '../api/client';

/**
 * The real apiClient, with only the transport replaced: axios builds each
 * request's interceptor chain when the request is dispatched, so this is the
 * only way to catch a 401 handler that is registered too late to see it.
 */
function respondWith(status: number): AxiosAdapter {
  return async (config) =>
    Promise.reject(
      new AxiosError('Request failed', 'ERR_BAD_REQUEST', config as never, null, {
        status,
        statusText: '',
        data: {},
        headers: {},
        config,
      } as never),
    );
}

describe('an expired session', () => {
  const realAdapter = apiClient.defaults.adapter;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    apiClient.defaults.adapter = realAdapter;
  });

  it('sends the user to the login page when the first request of a visit is rejected', async () => {
    // A token left in the browser after days away: it still looks like a session,
    // so the guard lets the page through and it asks for data straight away.
    localStorage.setItem('accessToken', 'expired-token');
    apiClient.defaults.adapter = respondWith(401);
    window.history.pushState({}, '', '/accounts/acc-1');

    render(<App />);

    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('leaves the session alone when a request fails for another reason', async () => {
    localStorage.setItem('accessToken', 'good-token');
    apiClient.defaults.adapter = respondWith(500);
    window.history.pushState({}, '', '/accounts/acc-1');

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить данные аккаунта');
    expect(localStorage.getItem('accessToken')).toBe('good-token');
  });
});
