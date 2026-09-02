import type { RaceConfig } from './config';

const FALLBACK_WORDS = [
  'the', 'quick', 'brown', 'fox', 'jumps', 'over', 'bright', 'keys', 'while',
  'friends', 'race', 'across', 'every', 'line', 'with', 'steady', 'focus',
  'typing', 'speed', 'accuracy', 'practice', 'makes', 'progress', 'possible',
];

const cache = new Map<string, string[]>();

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

async function loadWordList(siteOrigin: string, language: string): Promise<string[]> {
  const file = normalizeLanguageFile(language);
  if (cache.has(file)) return cache.get(file)!;
  let words = FALLBACK_WORDS;
  try {
    const origin = siteOrigin.replace(/\/+$/, '');
    const res = await fetch(`${origin}/lang/${file}.json`);
    if (res.ok) {
      const parsed = await res.json() as unknown;
      const list = Array.isArray(parsed) ? parsed : (parsed as { words?: string[] })?.words;
      if (Array.isArray(list) && list.length >= 10) {
        words = list
          .filter((w) => typeof w === 'string' && w.length > 0 && w.length <= 40)
          .slice(0, 100_000);
      }
    }
  } catch {
    /* fallback */
  }
  cache.set(file, words);
  if (cache.size > 12) cache.delete(cache.keys().next().value!);
  return words;
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
