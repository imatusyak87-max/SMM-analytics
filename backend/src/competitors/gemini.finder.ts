import axios from 'axios';
import { ChannelProfile, CompetitorFinder, FinderResult } from './competitor-finder';
import { parseFinderReply } from './parse-finder-reply';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_CAPTIONS = 30;
const MAX_CAPTION_CHARS = 400;

/**
 * Gemini 2.5 Flash with Google Search grounding: free up to 500 grounded
 * requests a day, which one run per added channel cannot approach. Grounding is
 * not free on 3.x models, so the model string is deliberate.
 *
 * Grounded generation cannot be combined with a strict response schema, so the
 * reply is parsed leniently instead of being constrained.
 */
export class GeminiFinder implements CompetitorFinder {
  constructor(
    private apiKey: string,
    private model = 'gemini-2.5-flash',
  ) {}

  async suggest(profile: ChannelProfile): Promise<FinderResult> {
    const body = {
      contents: [{ parts: [{ text: buildPrompt(profile) }] }],
      tools: [{ google_search: {} }],
    };

    let data: any;
    try {
      const response = await axios.post(`${ENDPOINT}/${this.model}:generateContent`, body, {
        headers: { 'x-goog-api-key': this.apiKey, 'Content-Type': 'application/json' },
        timeout: 120_000,
      });
      data = response.data;
    } catch (error) {
      throw translateError(error);
    }

    const text: string = (data?.candidates?.[0]?.content?.parts ?? [])
      .map((part: { text?: string }) => part?.text ?? '')
      .join('');
    const parsed = parseFinderReply(text);
    const usage = data?.usageMetadata ?? {};

    return {
      niche: parsed.niche,
      candidates: parsed.candidates,
      provider: 'gemini',
      model: this.model,
      inputTokens: typeof usage.promptTokenCount === 'number' ? usage.promptTokenCount : null,
      outputTokens: typeof usage.candidatesTokenCount === 'number' ? usage.candidatesTokenCount : null,
      // Free tier: tokens and grounded search are both free of charge.
      costUsd: 0,
    };
  }
}

function buildPrompt(profile: ChannelProfile): string {
  const captions = profile.captions
    .slice(0, MAX_CAPTIONS)
    .map((caption) => `- ${caption.slice(0, MAX_CAPTION_CHARS)}`)
    .join('\n');

  return [
    'Ты помогаешь аналитику Telegram-каналов найти ближайших конкурентов.',
    '',
    `Канал: ${profile.title} (@${profile.handle}), подписчиков: ${profile.followersCount}.`,
    `Описание: ${profile.description ?? 'нет'}`,
    'Последние посты:',
    captions || '- нет постов',
    '',
    'Найди через поиск до 20 русскоязычных Telegram-каналов той же тематики и',
    'сопоставимого размера. Используй каталоги каналов и подборки «похожие каналы».',
    `Не включай сам канал @${profile.handle}. Указывай только публичные каналы с @-именем.`,
    '',
    'Ответь ТОЛЬКО JSON без пояснений:',
    '{"niche":"<ниша канала по-русски>","competitors":[{"handle":"@channel","reason":"<почему конкурент, одна строка по-русски>","fit":<1-10>}]}',
  ].join('\n');
}

function translateError(error: unknown): Error {
  const status = (error as { response?: { status?: number } })?.response?.status;
  const message = String(
    (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? '',
  );
  if (status === 429) return new Error('Превышен лимит запросов, попробуйте позже');
  if (/location is not supported/i.test(message)) return new Error('Gemini недоступен из региона сервера');
  if (status === 401 || status === 403) return new Error('Ключ Gemini отклонён');
  return new Error(`Gemini не ответил: ${(error as Error).message ?? 'неизвестная ошибка'}`);
}
