import { translateInstagramError, isInstagramAuthError, isInstagramRateLimitError } from './instagram-error';

function axiosError(status: number, body: unknown, message = 'Request failed') {
  return { message, response: { status, data: body } };
}

describe('translateInstagramError', () => {
  it('reports an invalid/expired/revoked token in Russian', () => {
    const error = axiosError(400, { error: { type: 'OAuthException', code: 190, message: 'Error validating access token' } });

    expect(translateInstagramError(error).message).toBe('Instagram отклонил доступ, нужно переподключить аккаунт');
  });

  it('reports a rate limit in Russian', () => {
    const error = axiosError(429, { error: { type: 'OAuthException', code: 4, message: 'Application request limit reached' } });

    expect(translateInstagramError(error).message).toBe('Превышен лимит запросов к Instagram, попробуйте позже');
  });

  it('keeps the status and Instagram\'s own explanation for anything else', () => {
    const error = axiosError(500, { error: { message: 'Something went wrong, please try again' } });

    const translated = translateInstagramError(error);
    expect(translated.message).toMatch(/HTTP 500/);
    expect(translated.message).toMatch(/Something went wrong, please try again/);
  });

  it('describes a network failure with no response', () => {
    const error = { message: 'getaddrinfo ENOTFOUND graph.instagram.com' };

    expect(translateInstagramError(error).message).toBe('Instagram не ответил: getaddrinfo ENOTFOUND graph.instagram.com');
  });
});

describe('isInstagramAuthError', () => {
  it('is true for an OAuthException token error', () => {
    const error = axiosError(400, { error: { type: 'OAuthException', code: 190 } });

    expect(isInstagramAuthError(error)).toBe(true);
  });

  it('is false for a rate limit', () => {
    const error = axiosError(429, { error: { type: 'OAuthException', code: 4 } });

    expect(isInstagramAuthError(error)).toBe(false);
  });

  it('is false for a network error with no response', () => {
    expect(isInstagramAuthError({ message: 'ETIMEDOUT' })).toBe(false);
  });
});

describe('isInstagramRateLimitError', () => {
  const graphError = (status: number, code: number) => ({ response: { status, data: { error: { type: 'OAuthException', code } } } });

  it.each([4, 17, 32, 613])('treats Graph error code %i as a rate limit', (code) => {
    expect(isInstagramRateLimitError(graphError(400, code))).toBe(true);
  });

  it('treats a bare HTTP 429 as a rate limit', () => {
    expect(isInstagramRateLimitError({ response: { status: 429, data: {} } })).toBe(true);
  });

  it('does not treat an auth error or an ordinary bad request as a rate limit', () => {
    expect(isInstagramRateLimitError(graphError(400, 190))).toBe(false);
    expect(isInstagramRateLimitError(graphError(400, 100))).toBe(false);
    expect(isInstagramRateLimitError({ code: 'ETIMEDOUT' })).toBe(false);
  });
});
