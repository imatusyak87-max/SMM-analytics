import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

/**
 * Telegram echoes the `secret_token` given to setWebhook back on every update, in
 * this header. Without the check the endpoint is an open write path: anyone who
 * knows an account id could POST fabricated posts. Fails closed — an unconfigured
 * secret rejects everything rather than admitting everything.
 */
@Injectable()
export class TelegramWebhookGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const configured = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!configured) throw new UnauthorizedException();

    const request = context.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    const provided = request.headers['x-telegram-bot-api-secret-token'];
    if (!provided) throw new UnauthorizedException();

    const expectedBytes = Buffer.from(configured);
    const providedBytes = Buffer.from(provided);
    if (expectedBytes.length !== providedBytes.length) throw new UnauthorizedException();
    if (!timingSafeEqual(expectedBytes, providedBytes)) throw new UnauthorizedException();

    return true;
  }
}
