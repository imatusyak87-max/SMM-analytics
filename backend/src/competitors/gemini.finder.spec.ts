import axios from 'axios';
import { GeminiFinder } from './gemini.finder';
import { ChannelProfile } from './competitor-finder';

jest.mock('axios');
const mockedPost = axios.post as jest.MockedFunction<typeof axios.post>;

const profile: ChannelProfile = {
  handle: 'mychannel',
  title: 'Мой канал',
  followersCount: 5000,
  description: 'Про SMM',
  captions: ['Пост про рекламу', 'Пост про охваты'],
};

function reply(text: string) {
  return {
    data: {
      candidates: [{ content: { parts: [{ text }] } }],
      usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 300 },
    },
  };
}

describe('GeminiFinder', () => {
  beforeEach(() => jest.clearAllMocks());

  it('asks Gemini with Google Search grounding enabled and returns parsed candidates', async () => {
    mockedPost.mockResolvedValue(
      reply('{"niche":"SMM","competitors":[{"handle":"@rival","reason":"Та же тема","fit":8}]}') as any,
    );

    const result = await new GeminiFinder('key-123').suggest(profile);

    const [url, body, config] = mockedPost.mock.calls[0];
    expect(url).toContain('gemini-2.5-flash:generateContent');
    expect((body as any).tools).toEqual([{ google_search: {} }]);
    expect((config as any).headers['x-goog-api-key']).toBe('key-123');
    expect(result.candidates).toEqual([{ handle: 'rival', reason: 'Та же тема', fit: 8 }]);
    expect(result.niche).toBe('SMM');
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-2.5-flash');
    expect(result.inputTokens).toBe(1200);
    expect(result.outputTokens).toBe(300);
    expect(result.costUsd).toBe(0);
  });

  it('includes the channel title, description and captions in the prompt', async () => {
    mockedPost.mockResolvedValue(
      reply('{"niche":"SMM","competitors":[{"handle":"rival","reason":"Та же тема","fit":8}]}') as any,
    );

    await new GeminiFinder('key-123').suggest(profile);

    const prompt = (mockedPost.mock.calls[0][1] as any).contents[0].parts[0].text;
    expect(prompt).toContain('Мой канал');
    expect(prompt).toContain('Про SMM');
    expect(prompt).toContain('Пост про охваты');
    expect(prompt).toContain('@mychannel');
  });

  it('joins multi-part replies before parsing', async () => {
    mockedPost.mockResolvedValue({
      data: {
        candidates: [
          {
            content: {
              parts: [
                { text: '{"niche":"SMM","competitors":[' },
                { text: '{"handle":"rival","reason":"Та же тема","fit":8}]}' },
              ],
            },
          },
        ],
        usageMetadata: {},
      },
    } as any);

    const result = await new GeminiFinder('key-123').suggest(profile);

    expect(result.candidates).toHaveLength(1);
    expect(result.inputTokens).toBeNull();
  });

  it('reports a quota error in Russian', async () => {
    mockedPost.mockRejectedValue({ response: { status: 429 } });

    await expect(new GeminiFinder('key-123').suggest(profile)).rejects.toThrow(
      'Превышен лимит запросов, попробуйте позже',
    );
  });

  it('reports a blocked region in Russian', async () => {
    mockedPost.mockRejectedValue({
      response: { status: 400, data: { error: { message: 'User location is not supported' } } },
    });

    await expect(new GeminiFinder('key-123').suggest(profile)).rejects.toThrow(
      'Gemini недоступен из региона сервера',
    );
  });
});
