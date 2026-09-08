import { UnauthorizedException } from '@nestjs/common';
import { TelegramWebhookGuard } from './telegram-webhook.guard';

function contextWithHeaders(headers: Record<string, string>) {
  return { switchToHttp: () => ({ getRequest: () => ({ headers }) }) } as any;
}

describe('TelegramWebhookGuard', () => {
  const originalSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
    else process.env.TELEGRAM_WEBHOOK_SECRET = originalSecret;
  });

  it('allows an update carrying the configured secret token', () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'the-real-secret';
    const guard = new TelegramWebhookGuard();

    const allowed = guard.canActivate(
      contextWithHeaders({ 'x-telegram-bot-api-secret-token': 'the-real-secret' }),
    );

    expect(allowed).toBe(true);
  });

  it('rejects an update with no secret token header', () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'the-real-secret';
    const guard = new TelegramWebhookGuard();

    expect(() => guard.canActivate(contextWithHeaders({}))).toThrow(UnauthorizedException);
  });

  it('rejects an update whose secret token does not match', () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'the-real-secret';
    const guard = new TelegramWebhookGuard();

    expect(() =>
      guard.canActivate(contextWithHeaders({ 'x-telegram-bot-api-secret-token': 'guessed' })),
    ).toThrow(UnauthorizedException);
  });

  it('rejects every update when no secret is configured, rather than letting all of them through', () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const guard = new TelegramWebhookGuard();

    expect(() =>
      guard.canActivate(contextWithHeaders({ 'x-telegram-bot-api-secret-token': 'anything' })),
    ).toThrow(UnauthorizedException);
  });
});
