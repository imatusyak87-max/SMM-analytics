import { InstagramAccountKind } from '../../db/entities/instagram-oauth-state.entity';
import { InstagramDiscoveryClient, LinkedInstagramAccount } from './instagram-discovery.client';
import { InstagramDiscoveryConnectionService } from './instagram-discovery-connection.service';
import { InstagramOauthStateService } from './instagram-oauth-state.service';
import { translateInstagramError } from './instagram-error';

const DIALOG_URL = 'https://www.facebook.com/v23.0/dialog/oauth';
// pages_show_list lets /me/accounts find the Page, and business_management lets
// it see a Page owned by a business portfolio (otherwise /me/accounts comes back
// empty). The other three are what business_discovery itself requires.
const SCOPES = 'instagram_basic,instagram_manage_insights,pages_read_engagement,pages_show_list,business_management';

/** The one-time Facebook Login whose token every competitor lookup uses. */
export class InstagramDiscoveryOauthService {
  constructor(
    private stateService: InstagramOauthStateService,
    private client: InstagramDiscoveryClient,
    private connection: InstagramDiscoveryConnectionService,
    private appId: string,
    private redirectUri: string,
    private loginConfigId: string | null,
  ) {}

  async buildAuthorizeUrl(): Promise<string> {
    const state = await this.stateService.create(InstagramAccountKind.DISCOVERY);
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      state,
      // Facebook Login for Business apps define permissions in a configuration
      // instead of a scope list (plan Task 0 tells which this app needs).
      ...(this.loginConfigId ? { config_id: this.loginConfigId } : { scope: SCOPES }),
    });
    return `${DIALOG_URL}?${params.toString()}`;
  }

  async completeLogin(code: string, state: string): Promise<void> {
    const kind = await this.stateService.consume(state);
    if (kind !== InstagramAccountKind.DISCOVERY) {
      throw new Error('Ссылка для входа устарела, попробуйте подключить Facebook заново');
    }

    let token: string, expiresInSeconds: number | null, linked: LinkedInstagramAccount | null;
    try {
      const shortLived = await this.client.exchangeCodeForToken(code);
      ({ accessToken: token, expiresInSeconds } = await this.client.exchangeForLongLivedToken(shortLived));
      linked = await this.client.findLinkedInstagramAccount(token);
    } catch (error) {
      throw translateInstagramError(error);
    }
    if (!linked) throw new Error('К вашим страницам Facebook не привязан профессиональный аккаунт Instagram');

    await this.connection.save({
      igUserId: linked.igUserId,
      igUsername: linked.igUsername,
      token,
      expiresAt: expiresInSeconds === null ? null : new Date(Date.now() + expiresInSeconds * 1000),
    });
  }
}
