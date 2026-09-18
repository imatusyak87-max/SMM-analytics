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

  it('asks gemini-3.6-flash without the search tool and returns parsed candidates', async () => {
    mockedPost.mockResolvedValue(
      reply('{"niche":"SMM","competitors":[{"handle":"@rival","reason":"Та же тема","fit":8}]}') as any,
    );

    const result = await new GeminiFinder('key-123').suggest(profile);

    const [url, body, config] = mockedPost.mock.calls[0];
    expect(url).toContain('gemini-3.6-flash:generateContent');
    // Search grounding is not available on the free tier for 3.x models.
    expect((body as any).tools).toBeUndefined();
    expect((config as any).headers['x-goog-api-key']).toBe('key-123');
    expect(result.candidates).toEqual([{ handle: 'rival', reason: 'Та же тема', fit: 8 }]);
    expect(result.niche).toBe('SMM');
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-3.6-flash');
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
    // Without a search tool, asking the model to search would invite it to
    // pretend it did.
    expect(prompt).not.toContain('через поиск');
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

  it('keeps the status and Google\'s own explanation for an unclassified error', async () => {
    // The production failure that motivated this: the run row said only
    // "status code 404", while Google's body said why.
    mockedPost.mockRejectedValue({
      message: 'Request failed with status code 404',
      response: {
        status: 404,
        data: {
          error: {
            message:
              'This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.6-flash.',
          },
        },
      },
    });

    const failure = new GeminiFinder('key-123').suggest(profile);

    await expect(failure).rejects.toThrow(/HTTP 404/);
    await expect(failure).rejects.toThrow(/no longer available to new users/);
  });

  it('reports a rejected key in Russian', async () => {
    mockedPost.mockRejectedValue({ response: { status: 403, data: { error: { message: 'API key not valid' } } } });

    await expect(new GeminiFinder('key-123').suggest(profile)).rejects.toThrow('Ключ Gemini отклонён');
  });

  it('describes a network failure that never produced a response', async () => {
    mockedPost.mockRejectedValue({ message: 'getaddrinfo ENOTFOUND generativelanguage.googleapis.com' });

    await expect(new GeminiFinder('key-123').suggest(profile)).rejects.toThrow(
      'Gemini не ответил: getaddrinfo ENOTFOUND generativelanguage.googleapis.com',
    );
  });

  it('tells the model which channels were already checked', async () => {
    mockedPost.mockResolvedValue(
      reply('{"niche":"SMM","competitors":[{"handle":"@rival","reason":"Та же тема","fit":8}]}') as any,
    );

    await new GeminiFinder('key-123').suggest(profile, ['checked_one', 'checked_two']);

    const prompt = (mockedPost.mock.calls[0][1] as any).contents[0].parts[0].text;
    expect(prompt).toContain('@checked_one, @checked_two');
  });

  describe('when Google is overloaded', () => {
    // The production failure: "This model is currently experiencing high demand".
    const overloaded = {
      response: { status: 503, data: { error: { message: 'This model is currently experiencing high demand.' } } },
    };
    const noDelays = [0, 0];

    it('retries and succeeds once the overload passes', async () => {
      mockedPost
        .mockRejectedValueOnce(overloaded)
        .mockRejectedValueOnce(overloaded)
        .mockResolvedValueOnce(reply('{"niche":"SMM","competitors":[{"handle":"@rival","reason":"Та же тема","fit":8}]}') as any);

      const result = await new GeminiFinder('key-123', 'gemini-3.6-flash', noDelays).suggest(profile);

      expect(result.niche).toBe('SMM');
      expect(mockedPost).toHaveBeenCalledTimes(3);
    });

    it('gives up after the last retry with a plain Russian explanation', async () => {
      mockedPost.mockRejectedValue(overloaded);

      await expect(new GeminiFinder('key-123', 'gemini-3.6-flash', noDelays).suggest(profile)).rejects.toThrow(
        'Gemini перегружен, попробуйте через несколько минут',
      );
      expect(mockedPost).toHaveBeenCalledTimes(3);
    });

    it('does not retry errors that another attempt cannot fix', async () => {
      mockedPost.mockRejectedValue({ response: { status: 403 } });

      await expect(new GeminiFinder('key-123', 'gemini-3.6-flash', noDelays).suggest(profile)).rejects.toThrow();
      expect(mockedPost).toHaveBeenCalledTimes(1);
    });
  });
});
