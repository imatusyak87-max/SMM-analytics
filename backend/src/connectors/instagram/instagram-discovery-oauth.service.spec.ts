import { InstagramAccountKind } from '../../db/entities/instagram-oauth-state.entity';
import { InstagramDiscoveryOauthService } from './instagram-discovery-oauth.service';

const REDIRECT = 'https://fdagency.duckdns.org/api/instagram/discovery/callback';

function setup(overrides: { kind?: InstagramAccountKind | null; linked?: object | null; expiresIn?: number | null; configId?: string | null } = {}) {
  const stateService = {
    create: jest.fn().mockResolvedValue('state-uuid'),
    consume: jest.fn().mockResolvedValue(overrides.kind === undefined ? InstagramAccountKind.DISCOVERY : overrides.kind),
  };
  const client = {
    exchangeCodeForToken: jest.fn().mockResolvedValue('short'),
    exchangeForLongLivedToken: jest.fn().mockResolvedValue({ accessToken: 'long', expiresInSeconds: overrides.expiresIn === undefined ? 5_184_000 : overrides.expiresIn }),
    findLinkedInstagramAccount: jest.fn().mockResolvedValue(overrides.linked === undefined ? { igUserId: '1784', igUsername: 'fdagency' } : overrides.linked),
  };
  const connection = { save: jest.fn() };
  const service = new InstagramDiscoveryOauthService(
    stateService as any, client as any, connection as any, 'fb-app', REDIRECT, overrides.configId ?? null,
  );
  return { service, stateService, client, connection };
}

describe('InstagramDiscoveryOauthService', () => {
  it('builds the Facebook dialog URL with the discovery state and scopes', async () => {
    const { service, stateService } = setup();

    const url = new URL(await service.buildAuthorizeUrl());

    expect(stateService.create).toHaveBeenCalledWith(InstagramAccountKind.DISCOVERY);
    expect(url.origin + url.pathname).toBe('https://www.facebook.com/v23.0/dialog/oauth');
    expect(url.searchParams.get('client_id')).toBe('fb-app');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('state')).toBe('state-uuid');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('instagram_basic,instagram_manage_insights,pages_read_engagement,pages_show_list,business_management');
  });

  it('uses a Facebook Login for Business configuration instead of scopes when one is set', async () => {
    const { service } = setup({ configId: 'cfg-42' });

    const url = new URL(await service.buildAuthorizeUrl());

    expect(url.searchParams.get('config_id')).toBe('cfg-42');
    expect(url.searchParams.has('scope')).toBe(false);
  });

  it('stores the long-lived token for the linked Instagram account', async () => {
    const { service, client, connection } = setup();
    const before = Date.now();

    await service.completeLogin('the-code', 'state-uuid');

    expect(client.exchangeCodeForToken).toHaveBeenCalledWith('the-code');
    expect(client.exchangeForLongLivedToken).toHaveBeenCalledWith('short');
    expect(client.findLinkedInstagramAccount).toHaveBeenCalledWith('long');
    const saved = connection.save.mock.calls[0][0];
    expect(saved).toMatchObject({ igUserId: '1784', igUsername: 'fdagency', token: 'long' });
    expect(saved.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 5_184_000 * 1000);
  });

  it('stores a token without expiry as non-expiring', async () => {
    const { service, connection } = setup({ expiresIn: null });

    await service.completeLogin('the-code', 'state-uuid');

    expect(connection.save.mock.calls[0][0].expiresAt).toBeNull();
  });

  it.each([
    ['an unknown state', null],
    ['an Instagram-login state', InstagramAccountKind.OWN],
  ])('refuses %s without calling Facebook', async (_label, kind) => {
    const { service, client } = setup({ kind });

    await expect(service.completeLogin('the-code', 'state-uuid')).rejects.toThrow('Ссылка для входа устарела');
    expect(client.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('explains when no Page has an Instagram account linked', async () => {
    const { service, connection } = setup({ linked: null });

    await expect(service.completeLogin('the-code', 'state-uuid')).rejects.toThrow(
      'К вашим страницам Facebook не привязан профессиональный аккаунт Instagram',
    );
    expect(connection.save).not.toHaveBeenCalled();
  });

  it('translates a Graph error into a readable message', async () => {
    const { service, client } = setup();
    client.exchangeCodeForToken.mockRejectedValue({ response: { status: 400, data: { error: { message: 'Code expired' } } } });

    await expect(service.completeLogin('the-code', 'state-uuid')).rejects.toThrow('Code expired');
  });
});
