import { parseAccountLink } from './parse-account-link';
import { AccountPlatform } from '../db/entities/account.entity';

describe('parseAccountLink', () => {
  it('parses a Telegram channel link into platform and tag', () => {
    expect(parseAccountLink('https://t.me/somechannel')).toEqual({
      platform: AccountPlatform.TELEGRAM,
      externalId: '@somechannel',
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

  // Telegram usernames are case-insensitive, so t.me/MyChannel and t.me/mychannel
  // are one channel. Without normalising here they become two externalIds, and the
  // unique constraint on (platform, externalId) would not see them as duplicates.
  it('lowercases the handle so the same channel in different case parses identically', () => {
    expect(parseAccountLink('https://t.me/MyChannel')).toEqual({
      platform: AccountPlatform.TELEGRAM,
      externalId: '@mychannel',
    });
    expect(parseAccountLink('https://t.me/MyChannel')).toEqual(
      parseAccountLink('https://t.me/mychannel'),
    );
  });

  it('lowercases handles on the other platforms too', () => {
    expect(parseAccountLink('https://www.instagram.com/SomeOne/')?.externalId).toBe('@someone');
    expect(parseAccountLink('https://vk.com/SomeGroup')?.externalId).toBe('@somegroup');
  });
});
