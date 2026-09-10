const SUFFIXES: Record<string, number> = { K: 1_000, M: 1_000_000, B: 1_000_000_000 };

/**
 * Telegram renders counts compactly: "5.7M", "322K", "999". Values under 1000 are
 * exact; above that the number shown is rounded, so precision is genuinely lost at
 * the source and cannot be recovered here.
 */
export function parseCompactNumber(text: string | null | undefined): number | null {
  if (!text) return null;

  const cleaned = text.replace(/[\s, ]/g, '');
  const match = /^(\d+(?:\.\d+)?)([KMB])?$/i.exec(cleaned);
  if (!match) return null;

  const value = Number(match[1]);
  const multiplier = match[2] ? SUFFIXES[match[2].toUpperCase()] : 1;
  return Math.round(value * multiplier);
}
