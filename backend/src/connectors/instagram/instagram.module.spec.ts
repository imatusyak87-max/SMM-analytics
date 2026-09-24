import { Logger } from '@nestjs/common';
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
import { SyncJobService } from '../../sync/sync-job.service';
import { AccountsModule } from '../../accounts/accounts.module';

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

  it('no longer hosts the OAuth controller itself — AccountsModule does, for SyncJobService access', () => {
    expect(Reflect.getMetadata('controllers', InstagramModule) ?? []).not.toContain(InstagramOauthController);
    expect(Reflect.getMetadata('controllers', AccountsModule)).toContain(InstagramOauthController);
  });

  it('exports what the OAuth controller needs, so a host module can resolve it', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [InstagramModule],
      controllers: [InstagramOauthController],
      providers: [
        { provide: SyncJobService, useValue: { createManual: jest.fn() } },
        { provide: getRepositoryToken(Account), useValue: {} },
        { provide: getRepositoryToken(AccountCredential), useValue: {} },
      ],
    })
      .overrideProvider(getRepositoryToken(Account))
      .useValue({})
      .overrideProvider(getRepositoryToken(AccountCredential))
      .useValue({})
      .overrideProvider(getRepositoryToken(InstagramOauthState))
      .useValue({})
      .compile();

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

  describe('startup configuration warning', () => {
    let warn: jest.SpyInstance;
    beforeEach(() => {
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => warn.mockRestore());

    async function initModule() {
      const moduleRef = await compileModule();
      await moduleRef.init();
      return moduleRef;
    }

    it('stays quiet when Instagram is fully configured', async () => {
      await initModule();

      expect(warn).not.toHaveBeenCalled();
    });

    it('warns, without failing to boot, when the Instagram env vars are unset', async () => {
      delete process.env.INSTAGRAM_APP_ID;
      delete process.env.INSTAGRAM_APP_SECRET;
      delete process.env.INSTAGRAM_REDIRECT_URI;
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;

      await expect(initModule()).resolves.toBeDefined();

      const messages = warn.mock.calls.map((call) => String(call[0])).join(' | ');
      expect(messages).toContain('INSTAGRAM_APP_ID');
      expect(messages).toContain('INSTAGRAM_APP_SECRET');
      expect(messages).toContain('INSTAGRAM_REDIRECT_URI');
      expect(messages).toContain('CREDENTIAL_ENCRYPTION_KEY');
    });

    it('warns when CREDENTIAL_ENCRYPTION_KEY is not 64 hex characters, and never prints the key', async () => {
      process.env.CREDENTIAL_ENCRYPTION_KEY = 'not-hex-and-too-short';

      await initModule();

      const messages = warn.mock.calls.map((call) => String(call[0])).join(' | ');
      expect(messages).toContain('CREDENTIAL_ENCRYPTION_KEY');
      expect(messages).not.toContain('not-hex-and-too-short');
    });
  });
});
