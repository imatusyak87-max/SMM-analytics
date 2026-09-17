import { RankedCandidate } from './competitor-finder';

export interface ParsedReply {
  niche: string;
  candidates: RankedCandidate[];
}

const HANDLE = /^[a-z][a-z0-9_]{4,31}$/;

/** Turns '@Name', 'https://t.me/Name' or 'Name' into 'name'; null when it cannot be a channel. */
export function normalizeHandle(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .trim()
    .replace(/^https?:\/\/(www\.)?t\.me\//i, '')
    .replace(/^@/, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
  return HANDLE.test(cleaned) ? cleaned : null;
}

/** The model may wrap its JSON in prose or a code fence, so take the outermost object. */
function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('Модель вернула ответ без каналов');
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('Модель вернула ответ без каналов');
  }
}

export function parseFinderReply(text: string): ParsedReply {
  const parsed = extractJson(text) as { niche?: unknown; competitors?: unknown };
  const rows = Array.isArray(parsed.competitors) ? parsed.competitors : [];

  const candidates: RankedCandidate[] = [];
  for (const row of rows as Array<Record<string, unknown>>) {
    const handle = normalizeHandle(String(row?.handle ?? ''));
    const reason = typeof row?.reason === 'string' ? row.reason.trim() : '';
    if (!handle || reason === '') continue;
    const rawFit = Number(row?.fit);
    const fit = Number.isFinite(rawFit) ? Math.min(10, Math.max(1, Math.round(rawFit))) : 5;
    candidates.push({ handle, reason, fit });
  }

  if (candidates.length === 0) throw new Error('Модель вернула ответ без каналов');
  return {
    niche: typeof parsed.niche === 'string' && parsed.niche.trim() !== '' ? parsed.niche.trim() : 'Не определена',
    candidates,
  };
}
