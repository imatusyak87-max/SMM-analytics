export type DiscoveryUnavailableReason = 'not_connected' | 'reconnect';

/** Competitor lookups cannot run until the user (re)connects Facebook. */
export class InstagramDiscoveryUnavailableError extends Error {
  constructor(public readonly reason: DiscoveryUnavailableReason) {
    super(
      reason === 'not_connected'
        ? 'Чтобы добавлять конкурентов из Instagram, один раз подключите Facebook'
        : 'Доступ к Facebook истёк — переподключите Facebook, чтобы видеть конкурентов из Instagram',
    );
  }
}

/** Business Discovery only sees public Business/Creator accounts that are not age-gated. */
export class InstagramProfileNotFoundError extends Error {
  constructor() {
    super('Аккаунт не найден или это не бизнес-аккаунт Instagram');
  }
}
