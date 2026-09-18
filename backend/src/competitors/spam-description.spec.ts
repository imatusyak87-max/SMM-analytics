import { looksLikeSpam } from './spam-description';

describe('looksLikeSpam', () => {
  it('flags the "closed channel" funnel: several private invite links', () => {
    const description = [
      'НАШ ЗАКРЫТЫЙ КАНАЛ',
      'https://t.me/+kAwyh79Pg8o3ZDNi',
      'РЕЗЕРВ https://t.me/+Aq-DRvpQywhkMzUy',
      'ВПУСКАЕМ ДО 50 ЧЕЛОВЕК',
    ].join('\n');

    expect(looksLikeSpam(description)).toBe(true);
  });

  it('flags one invite link paired with bait wording', () => {
    expect(looksLikeSpam('Приватный канал с сигналами, осталось 10 мест: t.me/+AbCdEf123')).toBe(true);
    expect(looksLikeSpam('Успей попасть 👉 https://t.me/joinchat/AAAAAE1x2y3z')).toBe(true);
  });

  it('keeps an ordinary channel that links its discussion chat', () => {
    expect(looksLikeSpam('Новости маркетинга каждый день. Наш чат: https://t.me/+AbCdEf123')).toBe(false);
  });

  it('keeps channels whose descriptions only mention public @-channels or sites', () => {
    expect(looksLikeSpam('Резервный канал: @mychannel_backup, сайт example.ru')).toBe(false);
  });

  it('keeps channels with no description', () => {
    expect(looksLikeSpam(null)).toBe(false);
    expect(looksLikeSpam('')).toBe(false);
  });
});
