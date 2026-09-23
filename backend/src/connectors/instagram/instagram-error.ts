interface InstagramApiError {
  response?: { status?: number; data?: { error?: { type?: string; code?: number; message?: string } } };
  message?: string;
}

/** Meta's long-standing OAuthException code for an invalid/expired/revoked token. */
const AUTH_ERROR_CODE = 190;
/** OAuthException code 4 is Meta's app-wide rate limit, not a token problem. */
const RATE_LIMIT_CODE = 4;

function igError(error: unknown) {
  return (error as InstagramApiError)?.response?.data?.error;
}

export function isInstagramAuthError(error: unknown): boolean {
  const e = igError(error);
  return e?.type === 'OAuthException' && e?.code === AUTH_ERROR_CODE;
}

export function translateInstagramError(error: unknown): Error {
  const status = (error as InstagramApiError)?.response?.status;
  const e = igError(error);

  if (isInstagramAuthError(error)) {
    return new Error('Instagram отклонил доступ, нужно переподключить аккаунт');
  }
  if (e?.type === 'OAuthException' && e?.code === RATE_LIMIT_CODE) {
    return new Error('Превышен лимит запросов к Instagram, попробуйте позже');
  }
  if (status !== undefined) {
    const message = e?.message || (error as InstagramApiError).message || 'неизвестная ошибка';
    return new Error(`Instagram не ответил (HTTP ${status}): ${message}`);
  }
  return new Error(`Instagram не ответил: ${(error as InstagramApiError).message ?? 'неизвестная ошибка'}`);
}
