import { parseAccountLink } from './parse-account-link';
import { AccountPlatform } from '../db/entities/account.entity';

describe('parseAccountLink', () => {
  it('parses a Telegram channel link into platform and tag', () => {
    expect(parseAccountLink('https://t.me/fedulovadigital')).toEqual({
      platform: AccountPlatform.TELEGRAM,
      externalId: '@fedulovadigital',
    });
  });

  it('returns null for a domain that is not a known platform', () => {
    expect(parseAccountLink('https://example.com/someone')).toBeNull();
  });

  it('returns null when the link has no account segment', () => {
    expect(parseAccountLink('https://t.me/')).toBeNull();
  });

  it('returns null for a string that is not a URL', () => {
    expect(parseAccountLink('not a link')).toBeNull();
  });

  it('ignores a www prefix and a trailing slash', () => {
    expect(
      parseAccountLink('https://www.instagram.com/korableva_prohealth/'),
    ).toEqual({
      platform: AccountPlatform.INSTAGRAM,
      externalId: '@korableva_prohealth',
    });
  });

  it('parses VK, YouTube and LinkedIn links', () => {
    expect(parseAccountLink('https://vk.com/somegroup')?.platform).toBe(
      AccountPlatform.VK,
    );
    expect(
      parseAccountLink('https://www.youtube.com/@somechannel')?.platform,
    ).toBe(AccountPlatform.YOUTUBE);
    expect(
      parseAccountLink('https://www.linkedin.com/company/somecompany')
        ?.platform,
    ).toBe(AccountPlatform.LINKEDIN);
  });

  it('does not double up the @ prefix when the link already contains one', () => {
    expect(
      parseAccountLink('https://www.youtube.com/@somechannel')?.externalId,
    ).toBe('@somechannel');
  });
});
