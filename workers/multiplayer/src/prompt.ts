import type { RaceConfig } from './config';
import englishFallback from './english-fallback.json';

/** Matches lang/english.json — only used if the site wordlist fetch fails. */
const FALLBACK_WORDS: string[] = Array.isArray(englishFallback)
  ? englishFallback.filter((w): w is string => typeof w === 'string' && w.length > 0)
  : [];

const cache = new Map<string, string[]>();
const inflight = new Map<string, Promise<string[]>>();

function normalizeLanguageFile(language: string): string {
  // Keep filenames as on disk (english, english_10k, …). Do not rewrite _Nk → _NT.
  return String(language || 'english')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '') || 'english';
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
    // Wait for the real list — a short timeout previously fell back to a divergent word set.
    let words = await fetchWordList(siteOrigin, file, 8_000);
    if (!words && file !== 'english') {
      words = await fetchWordList(siteOrigin, 'english', 8_000);
    }
    if (!words || words.length < 10) {
      words = FALLBACK_WORDS.length >= 10 ? FALLBACK_WORDS.slice() : ['the', 'and', 'that', 'what', 'this', 'for', 'have', 'your', 'year', 'with'];
    }
    cache.set(file, words);
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
