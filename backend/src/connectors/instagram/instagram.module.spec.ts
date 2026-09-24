import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InstagramModule } from './instagram.module';
import { InstagramConnector } from './instagram.connector';
import { InstagramOauthController } from './instagram-oauth.controller';
import { InstagramOauthService } from './instagram-oauth.service';
import { InstagramTokenRefreshService } from './instagram-token-refresh.service';
import { Account } from '../../db/entities/account.entity';
import { AccountCredential } from '../../db/entities/account-credential.entity';
import { InstagramOauthState } from '../../db/entities/instagram-oauth-state.entity';

describe('InstagramModule', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      INSTAGRAM_APP_ID: 'app-id',
      INSTAGRAM_APP_SECRET: 'app-secret',
      INSTAGRAM_REDIRECT_URI: 'https://fdagency.duckdns.org/api/instagram/callback',
      CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  async function compileModule() {
    return Test.createTestingModule({ imports: [InstagramModule] })
      .overrideProvider(getRepositoryToken(Account))
      .useValue({})
      .overrideProvider(getRepositoryToken(AccountCredential))
      .useValue({})
      .overrideProvider(getRepositoryToken(InstagramOauthState))
      .useValue({})
      .compile();
  }

  it('provides an InstagramConnector', async () => {
    const moduleRef = await compileModule();

    expect(moduleRef.get(InstagramConnector)).toBeInstanceOf(InstagramConnector);
  });

  it('provides an InstagramOauthController', async () => {
    const moduleRef = await compileModule();

    expect(moduleRef.get(InstagramOauthController)).toBeInstanceOf(InstagramOauthController);
  });

  it('provides an InstagramOauthService', async () => {
    const moduleRef = await compileModule();

    expect(moduleRef.get(InstagramOauthService)).toBeInstanceOf(InstagramOauthService);
  });

  it('provides an InstagramTokenRefreshService', async () => {
    const moduleRef = await compileModule();

    expect(moduleRef.get(InstagramTokenRefreshService)).toBeInstanceOf(InstagramTokenRefreshService);
  });
});
