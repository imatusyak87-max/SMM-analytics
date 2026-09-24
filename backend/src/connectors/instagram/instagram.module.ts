import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Account } from '../../db/entities/account.entity';
import { AccountCredential } from '../../db/entities/account-credential.entity';
import { InstagramOauthState } from '../../db/entities/instagram-oauth-state.entity';
import { InstagramApiClient } from './instagram-api.client';
import { InstagramConnector } from './instagram.connector';
import { INSTAGRAM_APP_SECRET } from './instagram-oauth.controller';
import { InstagramOauthService } from './instagram-oauth.service';
import { InstagramOauthStateService } from './instagram-oauth-state.service';
import { InstagramTokenRefreshService } from './instagram-token-refresh.service';

const INSTAGRAM_API_CLIENT = 'INSTAGRAM_API_CLIENT';
const REQUIRED_ENV = ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET', 'INSTAGRAM_REDIRECT_URI'] as const;

/** Names what is missing or malformed — never the values themselves. */
function instagramConfigProblems(env: NodeJS.ProcessEnv): string[] {
  const problems: string[] = REQUIRED_ENV.filter((name) => !env[name]).map((name) => `${name} is not set`);
  if (!/^[0-9a-fA-F]{64}$/.test(env.CREDENTIAL_ENCRYPTION_KEY ?? '')) {
    problems.push('CREDENTIAL_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  }
  return problems;
}

/**
 * Owns everything Instagram-specific: OAuth state, credential encryption,
 * the API client, the connector, and the token-refresh cron. The public
 * OAuth/webhook controller's file lives here but AccountsModule registers
 * it. Exports InstagramConnector so ConnectorsModule can add it to the
 * platform-agnostic CONNECTORS registry — this module does not depend on ConnectorsModule, only the other way around.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Account, AccountCredential, InstagramOauthState])],
  providers: [
    {
      provide: INSTAGRAM_API_CLIENT,
      useFactory: () =>
        new InstagramApiClient(
          process.env.INSTAGRAM_APP_ID as string,
          process.env.INSTAGRAM_APP_SECRET as string,
          process.env.INSTAGRAM_REDIRECT_URI as string,
        ),
    },
    {
      provide: INSTAGRAM_APP_SECRET,
      useFactory: () => process.env.INSTAGRAM_APP_SECRET as string,
    },
    InstagramOauthStateService,
    {
      provide: InstagramOauthService,
      useFactory: (
        stateService: InstagramOauthStateService,
        api: InstagramApiClient,
        accountsRepo: any,
        credentialsRepo: any,
      ) =>
        new InstagramOauthService(
          stateService,
          api,
          accountsRepo,
          credentialsRepo,
          process.env.INSTAGRAM_APP_ID as string,
          process.env.CREDENTIAL_ENCRYPTION_KEY as string,
        ),
      inject: [InstagramOauthStateService, INSTAGRAM_API_CLIENT, getRepositoryToken(Account), getRepositoryToken(AccountCredential)],
    },
    {
      provide: InstagramConnector,
      useFactory: (api: InstagramApiClient, credentialsRepo: any) =>
        new InstagramConnector(api, credentialsRepo, process.env.CREDENTIAL_ENCRYPTION_KEY as string),
      inject: [INSTAGRAM_API_CLIENT, getRepositoryToken(AccountCredential)],
    },
    {
      provide: InstagramTokenRefreshService,
      useFactory: (accountsRepo: any, credentialsRepo: any, api: InstagramApiClient, stateService: InstagramOauthStateService) =>
        new InstagramTokenRefreshService(
          accountsRepo,
          credentialsRepo,
          api,
          process.env.CREDENTIAL_ENCRYPTION_KEY as string,
          stateService,
        ),
      inject: [getRepositoryToken(Account), getRepositoryToken(AccountCredential), INSTAGRAM_API_CLIENT, InstagramOauthStateService],
    },
  ],
  // InstagramConnector for ConnectorsModule (Task 12); InstagramOauthService
  // for AccountsModule's own connect endpoint (Task 13); InstagramOauthService
  // and INSTAGRAM_APP_SECRET also for InstagramOauthController, which
  // AccountsModule hosts so it can queue a first sync.
  exports: [InstagramConnector, InstagramOauthService, INSTAGRAM_APP_SECRET],
})
export class InstagramModule implements OnModuleInit {
  private readonly logger = new Logger(InstagramModule.name);

  /**
   * Warn only: the app (and every Telegram feature) must keep booting when
   * Instagram is not configured; connecting an Instagram account just won't work.
   */
  onModuleInit(): void {
    for (const problem of instagramConfigProblems(process.env)) {
      this.logger.warn(`Instagram is not fully configured: ${problem}`);
    }
  }
}
