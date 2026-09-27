import { cleanText } from '../text.utils';
import type { ExternalSourceDocument } from './web-provider.types';

export function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

export function contactEmail(): string {
  return process.env.CONTACT_EMAIL || 'prototipo-tesis@localhost';
}

export function defaultHeaders(): Record<string, string> {
  return {
    'User-Agent': `PrototipoTesis/1.0 (mailto:${contactEmail()})`,
    Accept: 'application/json',
  };
}

export function deduplicateByUrlOrContent(
  docs: ExternalSourceDocument[],
): ExternalSourceDocument[] {
  const unique = new Map<string, ExternalSourceDocument>();
  docs.forEach((doc) => {
    const key = doc.url
      ? `url:${doc.url}`
      : `content:${cleanText(doc.content).slice(0, 180)}`;
    if (!unique.has(key)) unique.set(key, doc);
  });
  return Array.from(unique.values());
}

export function rebuildOpenAlexAbstract(
  invertedIndex?: Record<string, number[]>,
): string {
  if (!invertedIndex) return '';
  const positionToWord: Array<{ pos: number; word: string }> = [];
  Object.entries(invertedIndex).forEach(([word, positions]) => {
    positions.forEach((pos) => positionToWord.push({ pos, word }));
  });
  positionToWord.sort((a, b) => a.pos - b.pos);
  return positionToWord.map((entry) => entry.word).join(' ');
}
