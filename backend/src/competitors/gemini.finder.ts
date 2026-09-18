import axios from 'axios';
import { ChannelProfile, CompetitorFinder, FinderResult } from './competitor-finder';
import { parseFinderReply } from './parse-finder-reply';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_CAPTIONS = 30;
const MAX_CAPTION_CHARS = 400;

/**
 * Gemini 3.6 Flash on the free tier, answering from its own knowledge.
 *
 * Search grounding was the original plan, but it was free only on 2.5 models,
 * and Google closed those to new projects ("no longer available to new users").
 * On 3.x, grounding needs a paid project, so this runs without the search tool.
 * The model therefore names channels from memory and some will not exist —
 * verification against the Bot API downstream is what keeps them out.
 *
 * The reply is parsed leniently rather than constrained by a response schema.
 */
export class GeminiFinder implements CompetitorFinder {
  constructor(
    private apiKey: string,
    private model = 'gemini-3.6-flash',
    // Free-tier models return 503 "high demand" at peak hours; it usually clears
    // within seconds, so a couple of quick retries beat failing the whole run.
    private retryDelaysMs: number[] = [5_000, 20_000],
  ) {}

  async suggest(profile: ChannelProfile, exclude: string[] = []): Promise<FinderResult> {
    const body = {
      contents: [{ parts: [{ text: buildPrompt(profile, exclude) }] }],
    };

    let data: any;
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await axios.post(`${ENDPOINT}/${this.model}:generateContent`, body, {
          headers: { 'x-goog-api-key': this.apiKey, 'Content-Type': 'application/json' },
          timeout: 120_000,
        });
        data = response.data;
        break;
      } catch (error) {
        if (!isTransient(error) || attempt >= this.retryDelaysMs.length) throw translateError(error);
        await new Promise((resolve) => setTimeout(resolve, this.retryDelaysMs[attempt]));
      }
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
      // Free tier: tokens are free of charge, and no search tool is used.
      costUsd: 0,
    };
  }
}

function buildPrompt(profile: ChannelProfile, exclude: string[]): string {
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
    'Назови до 20 русскоязычных Telegram-каналов той же тематики и сопоставимого',
    'размера, которые ты знаешь. Указывай только каналы, в существовании которых',
    'уверен: каждый будет проверен, так что лучше меньше, но реальных.',
    `Не включай сам канал @${profile.handle}. Указывай только публичные каналы с @-именем.`,
    'Только живые авторские каналы: без заброшенных, ботов и каналов-воронок в закрытые каналы.',
    ...(exclude.length > 0
      ? [`Эти каналы уже проверены, не называй их снова: ${exclude.map((handle) => `@${handle}`).join(', ')}.`]
      : []),
    '',
    'Ответь ТОЛЬКО JSON без пояснений:',
    '{"niche":"<ниша канала по-русски>","competitors":[{"handle":"@channel","reason":"<почему конкурент, одна строка по-русски>","fit":<1-10>}]}',
  ].join('\n');
}

/** Server-side hiccups (overload, gateway) that the same request may get past a moment later. */
function isTransient(error: unknown): boolean {
  const status = (error as { response?: { status?: number } })?.response?.status;
  return status === 500 || status === 502 || status === 503 || status === 504;
}

function translateError(error: unknown): Error {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status === 503) return new Error('Gemini перегружен, попробуйте через несколько минут');
  const message = String(
    (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? '',
  );
  if (status === 429) return new Error('Превышен лимит запросов, попробуйте позже');
  if (/location is not supported/i.test(message)) return new Error('Gemini недоступен из региона сервера');
  if (status === 401 || status === 403) return new Error('Ключ Gemini отклонён');
  // Keep Google's own explanation: it is the only place the real reason lives.
  // A bare "status code 404" once hid "this model is no longer available to new
  // users" and cost a manual investigation on the server.
  if (status !== undefined) {
    return new Error(
      `Gemini не ответил (HTTP ${status}): ${message || (error as Error).message || 'неизвестная ошибка'}`,
    );
  }
  return new Error(`Gemini не ответил: ${(error as Error).message ?? 'неизвестная ошибка'}`);
}
