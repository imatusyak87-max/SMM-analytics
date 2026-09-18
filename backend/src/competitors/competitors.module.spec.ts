import { resolveCompetitorConfig, resolveCompetitorFinder } from './competitors.module';
import { GeminiFinder } from './gemini.finder';

describe('competitor provider selection (COMPETITOR_LLM)', () => {
  it('defaults to gemini when COMPETITOR_LLM is unset', () => {
    const config = resolveCompetitorConfig({ GEMINI_API_KEY: 'key-1' });
    expect(config.provider).toBe('gemini');

    const finder = resolveCompetitorFinder({ GEMINI_API_KEY: 'key-1' });
    expect(finder).toBeInstanceOf(GeminiFinder);
  });

  it('behaves exactly as before when COMPETITOR_LLM=gemini is set explicitly', () => {
    const config = resolveCompetitorConfig({ COMPETITOR_LLM: 'gemini', GEMINI_API_KEY: 'key-1' });
    expect(config.provider).toBe('gemini');
    expect(config.model).toBe('gemini-2.5-flash');
    expect(config.enabled).toBe(true);

    const finder = resolveCompetitorFinder({ COMPETITOR_LLM: 'gemini', GEMINI_API_KEY: 'key-1' });
    expect(finder).toBeInstanceOf(GeminiFinder);
  });

  it('throws a clear error naming the provider when COMPETITOR_LLM=claude is set (not implemented)', () => {
    expect(() => resolveCompetitorConfig({ COMPETITOR_LLM: 'claude', GEMINI_API_KEY: 'key-1' })).toThrow(
      /claude/i,
    );
    expect(() => resolveCompetitorFinder({ COMPETITOR_LLM: 'claude', GEMINI_API_KEY: 'key-1' })).toThrow(
      /gemini/i,
    );
  });

  it('throws for any other unsupported value', () => {
    expect(() => resolveCompetitorConfig({ COMPETITOR_LLM: 'gpt4' })).toThrow(/gpt4/);
  });

  it('disables the feature with no GEMINI_API_KEY, same as before', () => {
    const config = resolveCompetitorConfig({});
    expect(config.enabled).toBe(false);
  });
});
