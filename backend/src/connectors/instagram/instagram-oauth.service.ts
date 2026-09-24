import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account, AccountPlatform, AccountType } from '../../db/entities/account.entity';
import { AccountCredential } from '../../db/entities/account-credential.entity';
import { InstagramAccountKind } from '../../db/entities/instagram-oauth-state.entity';
import { InstagramApiClient, InstagramProfile } from './instagram-api.client';
import { InstagramOauthStateService } from './instagram-oauth-state.service';
import { encryptToken } from './instagram-token-crypto';
import { translateInstagramError } from './instagram-error';

const AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize';
// Confirmed against the real consent screen in Task 0, step 1.
const SCOPES = 'instagram_business_basic,instagram_business_manage_insights';

@Injectable()
export class InstagramOauthService {
  constructor(
    private stateService: InstagramOauthStateService,
    private api: InstagramApiClient,
    @InjectRepository(Account) private accountsRepo: Repository<Account>,
    @InjectRepository(AccountCredential) private credentialsRepo: Repository<AccountCredential>,
    private appId: string,
    private encryptionKey: string,
  ) {}

  async buildAuthorizeUrl(type: InstagramAccountKind): Promise<string> {
    const state = await this.stateService.create(type);
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.redirectUri(),
      scope: SCOPES,
      response_type: 'code',
      state,
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  async completeLogin(code: string, state: string): Promise<Account> {
    const type = await this.stateService.consume(state);
    if (!type) {
      throw new Error('Ссылка для входа устарела, попробуйте подключить аккаунт заново');
    }

    let shortLivedToken: string, longLivedToken: string, expiresInSeconds: number;
    let profile: InstagramProfile;
    try {
      ({ accessToken: shortLivedToken } = await this.api.exchangeCodeForToken(code));
      ({ accessToken: longLivedToken, expiresInSeconds } = await this.api.exchangeForLongLivedToken(shortLivedToken));
      profile = await this.api.getProfile(longLivedToken);
    } catch (error) {
      // The client throws raw, untranslated errors (Task 5) — this is the
      // layer that turns one into a message safe to show the user.
      throw translateInstagramError(error);
    }

    if (!profile.id) throw new Error('Instagram не вернул идентификатор аккаунта, попробуйте подключить заново');
    // The token response's user_id is a JSON number that can exceed 2^53 and
    // lose precision; /me returns the same id as a string, so key on that.
    const instagramUserId = String(profile.id);

    const encryptedToken = encryptToken(longLivedToken, this.encryptionKey);
    const tokenExpiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    // externalId is Instagram's numeric user id, not @username — see the plan's
    // Global Constraints for why. This is what makes reconnect an update, not
    // a duplicate insert, on a second login for the same account.
    const existing = await this.accountsRepo.findOneBy({ platform: AccountPlatform.INSTAGRAM, externalId: instagramUserId });

    if (existing) {
      // save() on the accountId primary key is an upsert: it re-creates the
      // row the data-deletion webhook removed, where update() would touch 0 rows.
      await this.credentialsRepo.save({ accountId: existing.id, encryptedToken, tokenExpiresAt, needsReconnect: false });
      return existing;
    }

    const account = await this.accountsRepo.save({
      platform: AccountPlatform.INSTAGRAM,
      externalId: instagramUserId,
      name: profile.name ?? profile.username,
      avatarUrl: profile.profilePictureUrl,
      type: type === InstagramAccountKind.OWN ? AccountType.OWN : AccountType.CLIENT,
      isActive: true,
    });
    await this.credentialsRepo.save({ accountId: account.id, encryptedToken, tokenExpiresAt, needsReconnect: false });
    return account;
  }

  private redirectUri(): string {
    return process.env.INSTAGRAM_REDIRECT_URI as string;
  }
}
