import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account, AccountPlatform, AccountType } from '../../db/entities/account.entity';
import { AccountCredential } from '../../db/entities/account-credential.entity';
import { InstagramAccountKind } from '../../db/entities/instagram-oauth-state.entity';
import { InstagramApiClient, InstagramProfile } from './instagram-api.client';
import { InstagramOauthStateService } from './instagram-oauth-state.service';
import { encryptToken } from './instagram-token-crypto';
import { translateInstagramError } from './instagram-error';

const EXPIRED = 'Ссылка для входа устарела, попробуйте подключить аккаунт заново';

/** A login for a known account failed; the callback sends the user back to that account with the message. */
export class InstagramLoginError extends Error {
  constructor(message: string, readonly accountId: string) {
    super(message);
  }
}

const AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize';
// Confirmed against the real consent screen in Task 0, step 1.
const SCOPES = 'instagram_business_basic,instagram_business_manage_insights';

@Injectable()
export class InstagramOauthService {
  private readonly logger = new Logger(InstagramOauthService.name);

  constructor(
    private stateService: InstagramOauthStateService,
    private api: InstagramApiClient,
    @InjectRepository(Account) private accountsRepo: Repository<Account>,
    @InjectRepository(AccountCredential) private credentialsRepo: Repository<AccountCredential>,
    private appId: string,
    private encryptionKey: string,
  ) {}

  async buildAuthorizeUrlForAccount(account: Account): Promise<string> {
    if (account.platform !== AccountPlatform.INSTAGRAM) {
      throw new BadRequestException('Полный доступ есть только для Instagram');
    }
    const state = await this.stateService.create(InstagramAccountKind.OWN, account.id);
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.redirectUri(),
      scope: SCOPES,
      response_type: 'code',
      state,
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  /**
   * Every login is for one existing account: a public one (added by link) is
   * upgraded to full access, an own one is reconnected. The logged-in Instagram
   * account must be that account, or nothing changes.
   */
  async completeLogin(code: string, state: string): Promise<Account> {
    const consumed = await this.stateService.consume(state);
    if (!consumed || consumed.type === InstagramAccountKind.DISCOVERY || !consumed.accountId) throw new Error(EXPIRED);

    const account = await this.accountsRepo.findOneBy({ id: consumed.accountId });
    if (!account) throw new Error('Аккаунт больше не существует');

    let longLivedToken: string, expiresInSeconds: number;
    let profile: InstagramProfile;
    try {
      const { accessToken: shortLivedToken } = await this.api.exchangeCodeForToken(code);
      ({ accessToken: longLivedToken, expiresInSeconds } = await this.api.exchangeForLongLivedToken(shortLivedToken));
      profile = await this.api.getProfile(longLivedToken);
    } catch (error) {
      throw new InstagramLoginError(translateInstagramError(error).message, account.id);
    }

    try {
        if (!profile.id) throw new InstagramLoginError('Instagram не вернул идентификатор аккаунта, попробуйте подключить заново', account.id);
        // /me returns the id as a string; the token response's numeric user_id can lose precision.
        const instagramUserId = String(profile.id);

        if (account.type === AccountType.PUBLIC_NO_ACCESS) {
          const expected = account.externalId.replace(/^@/, '').toLowerCase();
          if ((profile.username ?? '').toLowerCase() !== expected) {
            throw new InstagramLoginError(
              `Вы вошли в другой аккаунт Instagram (@${profile.username}), а проект ждёт @${expected}`,
              account.id,
            );
          }
          const clash = await this.accountsRepo.findOneBy({ platform: AccountPlatform.INSTAGRAM, externalId: instagramUserId });
          if (clash && clash.id !== account.id) {
            throw new InstagramLoginError('Этот аккаунт Instagram уже подключён отдельно — удалите дубликат и попробуйте снова', account.id);
          }
        } else if (account.externalId !== instagramUserId) {
          throw new InstagramLoginError(`Вы вошли в другой аккаунт Instagram (@${profile.username})`, account.id);
        }

        const encryptedToken = encryptToken(longLivedToken, this.encryptionKey);
        const tokenExpiresAt = new Date(Date.now() + expiresInSeconds * 1000);
        // Own accounts are keyed by the numeric id (deauthorize, data-deletion and
        // dedup all look them up that way), so an upgrade switches to it.
        const changes = {
          type: account.type === AccountType.PUBLIC_NO_ACCESS ? AccountType.OWN : account.type,
          externalId: instagramUserId,
          name: profile.name ?? profile.username,
          avatarUrl: profile.profilePictureUrl,
        };
        await this.accountsRepo.manager.transaction(async (em) => {
          await em.update(Account, { id: account.id }, changes);
          // save() upserts on accountId: it re-creates a credential the data-deletion webhook removed.
          await em.save(AccountCredential, { accountId: account.id, encryptedToken, tokenExpiresAt, needsReconnect: false });
        });
        return { ...account, ...changes };
    } catch (error) {
      if (error instanceof InstagramLoginError) throw error;
      this.logger.warn(`Instagram login for account ${account.id} failed: ${(error as Error).message}`);
      throw new InstagramLoginError('Не удалось подключить Instagram, попробуйте ещё раз', account.id);
    }
  }

  private redirectUri(): string {
    return process.env.INSTAGRAM_REDIRECT_URI as string;
  }
}
