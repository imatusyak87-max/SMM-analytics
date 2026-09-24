import { randomUUID } from 'crypto';
import { Body, Controller, Get, Inject, Logger, Post, Query, Res } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Response } from 'express';
import { Account, AccountPlatform } from '../../db/entities/account.entity';
import { AccountCredential } from '../../db/entities/account-credential.entity';
import { SyncJobService } from '../../sync/sync-job.service';
import { InstagramOauthService } from './instagram-oauth.service';
import { verifySignedRequest } from './instagram-signed-request';

export const INSTAGRAM_APP_SECRET = 'INSTAGRAM_APP_SECRET';

/**
 * Public: reached by a browser redirect (callback) or Meta's own servers
 * (deauthorize, data-deletion), neither of which can carry our JWT. Routes
 * match exactly what was configured in the Meta app dashboard — see the
 * plan's Global Constraints.
 *
 * Registered in AccountsModule (not InstagramModule) so it can queue the
 * account's first sync through SyncJobService — SyncModule already depends
 * on InstagramModule via ConnectorsModule, so the reverse import would cycle.
 */
@Controller('instagram')
export class InstagramOauthController {
  private readonly logger = new Logger(InstagramOauthController.name);

  constructor(
    private oauthService: InstagramOauthService,
    @InjectRepository(Account) private accountsRepo: Repository<Account>,
    @InjectRepository(AccountCredential) private credentialsRepo: Repository<AccountCredential>,
    @Inject(INSTAGRAM_APP_SECRET) private appSecret: string,
    private syncJobs: SyncJobService,
  ) {}

  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    let accountId: string;
    try {
      ({ id: accountId } = await this.oauthService.completeLogin(code, state));
    } catch (error) {
      res.status(400).json({ message: (error as Error).message });
      return;
    }

    // A freshly connected (or reconnected) account should not sit empty until
    // the 3am run. Queueing is best-effort: the login itself already succeeded.
    try {
      await this.syncJobs.createManual(accountId);
    } catch (error) {
      this.logger.warn(`Could not queue the first sync for Instagram account ${accountId}: ${(error as Error).message}`);
    }
    res.redirect(`/accounts/${accountId}`);
  }

  @Post('deauthorize')
  async deauthorize(@Body() body: { signed_request: string }, @Res() res: Response) {
    const verified = verifySignedRequest(body?.signed_request ?? '', this.appSecret);
    if (verified) {
      const account = await this.accountsRepo.findOneBy({ platform: AccountPlatform.INSTAGRAM, externalId: verified.userId });
      if (account) await this.credentialsRepo.update({ accountId: account.id }, { needsReconnect: true });
    }
    // Meta expects 200 regardless — an unrecognised signature is simply ignored,
    // never surfaced as an error to a system that will just retry it.
    res.status(200).json({});
  }

  @Post('data-deletion')
  async dataDeletion(@Body() body: { signed_request: string }, @Res() res: Response) {
    const verified = verifySignedRequest(body?.signed_request ?? '', this.appSecret);
    if (verified) {
      const account = await this.accountsRepo.findOneBy({ platform: AccountPlatform.INSTAGRAM, externalId: verified.userId });
      // Deletes only our stored access; Post/AccountSnapshot history stays,
      // the same as deactivating any other account — confirmed with the user.
      if (account) await this.credentialsRepo.delete({ accountId: account.id });
    }
    const confirmationCode = randomUUID();
    res.status(200).json({
      url: `https://fdagency.duckdns.org/data-deletion-status/${confirmationCode}`,
      confirmation_code: confirmationCode,
    });
  }
}
