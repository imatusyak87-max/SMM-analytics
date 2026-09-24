import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { Account, AccountPlatform } from '../../db/entities/account.entity';
import { AccountCredential } from '../../db/entities/account-credential.entity';
import { InstagramApiClient } from './instagram-api.client';
import { decryptToken, encryptToken } from './instagram-token-crypto';
import { isInstagramAuthError } from './instagram-error';

const REFRESH_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class InstagramTokenRefreshService {
  private readonly logger = new Logger(InstagramTokenRefreshService.name);

  constructor(
    @InjectRepository(Account) private accountsRepo: Repository<Account>,
    @InjectRepository(AccountCredential) private credentialsRepo: Repository<AccountCredential>,
    private api: InstagramApiClient,
    private encryptionKey: string,
  ) {}

  /** Runs 30 minutes before the 3am sync, so a freshly refreshed token is ready when it fires. */
  @Cron('30 2 * * *')
  async refreshExpiring(): Promise<void> {
    const accounts = await this.accountsRepo.find({ where: { platform: AccountPlatform.INSTAGRAM } });
    const accountIds = new Set(accounts.map((a) => a.id));

    const dueSoon = await this.credentialsRepo.find({
      where: { tokenExpiresAt: LessThanOrEqual(new Date(Date.now() + REFRESH_WINDOW_DAYS * DAY_MS)) },
    });

    for (const credential of dueSoon.filter((c) => accountIds.has(c.accountId))) {
      try {
        const token = decryptToken(credential.encryptedToken, this.encryptionKey);
        const refreshed = await this.api.refreshLongLivedToken(token);
        await this.credentialsRepo.update(
          { accountId: credential.accountId },
          {
            encryptedToken: encryptToken(refreshed.accessToken, this.encryptionKey),
            tokenExpiresAt: new Date(Date.now() + refreshed.expiresInSeconds * 1000),
            needsReconnect: false,
          },
        );
      } catch (error) {
        if (isInstagramAuthError(error)) {
          await this.credentialsRepo.update({ accountId: credential.accountId }, { needsReconnect: true });
        } else {
          this.logger.warn(`Could not refresh Instagram token for account ${credential.accountId}: ${(error as Error).message}`);
        }
        // One account's failure must not stop the rest from refreshing.
      }
    }
  }
}
