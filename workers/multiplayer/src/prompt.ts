import type { RaceConfig } from './config';

/** Used when the language file is slow/unavailable so room create stays snappy. */
const FALLBACK_WORDS = [
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'I',
  'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
  'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
  'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
  'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me',
  'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know', 'take',
  'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them', 'see', 'other',
  'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also',
  'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first', 'well', 'way',
  'even', 'new', 'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us',
  'quick', 'brown', 'fox', 'jumps', 'bright', 'keys', 'while', 'friends', 'race',
  'across', 'every', 'line', 'steady', 'focus', 'typing', 'speed', 'accuracy',
  'practice', 'makes', 'progress', 'possible', 'words', 'flow', 'smooth', 'hands',
];

const cache = new Map<string, string[]>();
const inflight = new Map<string, Promise<string[]>>();

function normalizeLanguageFile(language: string): string {
  const safe = String(language || 'english')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '') || 'english';
  return safe.replace(/_(\d+)k$/, '_$1T');
}

function decorateWord(word: string, index: number, config: RaceConfig): string {
  let value = String(word);
  if (config.nums && index > 0 && index % 11 === 0) {
    value = String(10 + Math.floor(Math.random() * 990));
  }
  if (config.punct) {
    if (index % 13 === 0) value = value.charAt(0).toUpperCase() + value.slice(1);
    if (index % 9 === 8) value += ['.', ',', '?', '!'][Math.floor(Math.random() * 4)];
  }
  return value;
}

function parseWordList(parsed: unknown): string[] | null {
  const list = Array.isArray(parsed) ? parsed : (parsed as { words?: string[] })?.words;
  if (!Array.isArray(list) || list.length < 10) return null;
  return list
    .filter((w) => typeof w === 'string' && w.length > 0 && w.length <= 40)
    .slice(0, 100_000);
}

async function fetchWordList(siteOrigin: string, file: string, timeoutMs: number): Promise<string[] | null> {
  const origin = siteOrigin.replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${origin}/lang/${file}.json`, { signal: controller.signal });
    if (!res.ok) return null;
    return parseWordList(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function loadWordList(siteOrigin: string, language: string): Promise<string[]> {
  const file = normalizeLanguageFile(language);
  if (cache.has(file)) return cache.get(file)!;
  const existing = inflight.get(file);
  if (existing) return existing;

  const load = (async () => {
    // Prefer a fast response for room create; warm the full list in the background if needed.
    let words = await fetchWordList(siteOrigin, file, 280);
    if (!words) {
      words = FALLBACK_WORDS;
      // Background warm (best-effort) so later rooms get the real list.
      void fetchWordList(siteOrigin, file, 8_000).then((full) => {
        if (full && full.length >= 10) {
          cache.set(file, full);
        }
      });
    } else {
      cache.set(file, words);
    }
    if (cache.size > 12) cache.delete(cache.keys().next().value!);
    return words;
  })();

  inflight.set(file, load);
  try {
    return await load;
  } finally {
    inflight.delete(file);
  }
}

export interface Prompt {
  words: string[];
  targetWordCount: number;
  textHash: string;
}

export async function createPrompt(siteOrigin: string, config: RaceConfig): Promise<Prompt> {
  const source = await loadWordList(siteOrigin, config.lang);
  const targetWordCount = config.mode === 'words'
    ? config.amount
    : Math.max(120, config.amount * 6);
  const words: string[] = [];
  let previous = '';
  for (let i = 0; i < targetWordCount; i += 1) {
    let next = source[Math.floor(Math.random() * source.length)] || FALLBACK_WORDS[i % FALLBACK_WORDS.length];
    if (source.length > 1 && next === previous) {
      next = source[(source.indexOf(next) + 1) % source.length];
    }
    words.push(decorateWord(next, i, config));
    previous = next;
  }
  const data = new TextEncoder().encode(words.join(' '));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
  return { words, targetWordCount, textHash: hash };
}
