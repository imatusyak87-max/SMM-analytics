import { parseFinderReply, normalizeHandle } from './parse-finder-reply';

describe('normalizeHandle', () => {
  it('accepts a bare handle, an @handle and a t.me link, always lowercased', () => {
    expect(normalizeHandle('DurovCodes')).toBe('durovcodes');
    expect(normalizeHandle('@DurovCodes')).toBe('durovcodes');
    expect(normalizeHandle('https://t.me/DurovCodes')).toBe('durovcodes');
  });

  it('rejects anything that cannot be a channel handle', () => {
    expect(normalizeHandle('abc')).toBeNull();
    expect(normalizeHandle('has spaces')).toBeNull();
    expect(normalizeHandle('9starts_with_digit')).toBeNull();
    expect(normalizeHandle('')).toBeNull();
  });
});

describe('parseFinderReply', () => {
  const reply = JSON.stringify({
    niche: 'Маркетинг в Telegram',
    competitors: [
      { handle: '@smmplanner', reason: 'Тот же сегмент SMM', fit: 9 },
      { handle: 'tgmarketing', reason: 'Похожая аудитория', fit: 7 },
    ],
  });

  it('parses a clean JSON reply', () => {
    const result = parseFinderReply(reply);
    expect(result.niche).toBe('Маркетинг в Telegram');
    expect(result.candidates).toEqual([
      { handle: 'smmplanner', reason: 'Тот же сегмент SMM', fit: 9 },
      { handle: 'tgmarketing', reason: 'Похожая аудитория', fit: 7 },
    ]);
  });

  it('parses JSON inside a fenced code block', () => {
    expect(parseFinderReply('```json\n' + reply + '\n```').candidates).toHaveLength(2);
  });

  it('parses JSON surrounded by prose', () => {
    expect(parseFinderReply(`Вот результат:\n${reply}\nНадеюсь, помог.`).candidates).toHaveLength(2);
  });

  it('drops entries with an unusable handle or no reason, and clamps fit to 1..10', () => {
    const messy = JSON.stringify({
      niche: 'Тест',
      competitors: [
        { handle: 'ok_channel', reason: 'Подходит', fit: 42 },
        { handle: 'no', reason: 'Слишком короткий хэндл', fit: 5 },
        { handle: 'missing_reason', fit: 5 },
      ],
    });
    expect(parseFinderReply(messy).candidates).toEqual([
      { handle: 'ok_channel', reason: 'Подходит', fit: 10 },
    ]);
  });

  it('throws when no candidates can be read', () => {
    expect(() => parseFinderReply('Извините, ничего не нашёл')).toThrow(
      'Модель вернула ответ без каналов',
    );
  });
});
