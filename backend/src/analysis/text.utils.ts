// ─────────────────────────────────────────────────────────────────────────────
// Stopwords en español (lista ampliada)
// ─────────────────────────────────────────────────────────────────────────────
const STOPWORDS = new Set([
  'el',
  'la',
  'los',
  'las',
  'de',
  'del',
  'y',
  'a',
  'en',
  'un',
  'una',
  'unos',
  'unas',
  'con',
  'por',
  'para',
  'es',
  'al',
  'lo',
  'como',
  'más',
  'mas',
  'pero',
  'sus',
  'le',
  'ya',
  'o',
  'este',
  'sí',
  'si',
  'porque',
  'esta',
  'entre',
  'cuando',
  'muy',
  'sin',
  'sobre',
  'también',
  'tambien',
  'me',
  'hasta',
  'hay',
  'donde',
  'quien',
  'desde',
  'todo',
  'nos',
  'ser',
  'fue',
  'han',
  'has',
  'había',
  'habia',
  'era',
  'son',
  'están',
  'estan',
  'que',
  'se',
  'su',
  'no',
  'ni',
  'te',
  'mi',
  'tu',
  'él',
  'ellos',
  'ellas',
  'we',
  'the',
  'is',
  'are',
  'was',
  'were',
  'has',
  'have',
  'had',
  'be',
  'been',
  'being',
  'of',
  'in',
  'to',
  'for',
  'on',
  'at',
  'by',
  'an',
  'it',
  'its',
  'or',
  'and',
  'not',
]);

// ─────────────────────────────────────────────────────────────────────────────
// cleanText — normaliza para comparación TF-IDF
// ─────────────────────────────────────────────────────────────────────────────
export function cleanText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar tildes
    .replace(/[^\w\s]/gi, ' ') // signos → espacio (no vacío, para no pegar palabras)
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word))
    .join(' ')
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// splitIntoParagraphs — segmentación robusta para PDFs
//
// Estrategia en cascada:
//   1. Líneas en blanco dobles  (\n\n)  → párrafos clásicos
//   2. Saltos de línea simples  (\n)    → líneas individuales
//   3. Puntos finales de oración        → fallback para texto continuo sin \n
//   4. Ventanas deslizantes de N tokens → último recurso para bloques enormes
// ─────────────────────────────────────────────────────────────────────────────
export function splitIntoParagraphs(text: string): string[] {
  const MIN_LEN = 40; // mínimo de caracteres para considerar un segmento
  const MAX_LEN = 1200; // máximo antes de partir un párrafo largo
  const WINDOW_TOKENS = 80; // tokens por ventana deslizante (último recurso)

  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) return [];

  // ── Nivel 1: párrafos por línea en blanco ──────────────────────────────────
  const byBlankLine = normalized
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\n/g, ' ').trim())
    .filter((p) => p.length >= MIN_LEN);

  if (byBlankLine.length >= 3) {
    return splitLongSegments(byBlankLine, MAX_LEN, MIN_LEN);
  }

  // ── Nivel 2: saltos de línea simples ──────────────────────────────────────
  const bySingleLine = normalized
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= MIN_LEN);

  if (bySingleLine.length >= 3) {
    return splitLongSegments(bySingleLine, MAX_LEN, MIN_LEN);
  }

  // ── Nivel 3: oraciones (PDF continuo sin saltos) ──────────────────────────
  const bySentence = normalized
    .replace(/([.!?])\s+/g, '$1\n')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_LEN);

  // Agrupar oraciones de 3 en 3 para dar más contexto a cada segmento
  if (bySentence.length >= 2) {
    const grouped: string[] = [];
    for (let i = 0; i < bySentence.length; i += 3) {
      const chunk = bySentence.slice(i, i + 3).join(' ');
      if (chunk.length >= MIN_LEN) grouped.push(chunk);
    }
    if (grouped.length >= 2) return grouped;
  }

  // ── Nivel 4: ventana deslizante por tokens (último recurso) ───────────────
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length < 10) return [normalized];

  const windows: string[] = [];
  const step = Math.floor(WINDOW_TOKENS * 0.6); // 40% de solapamiento
  for (let i = 0; i < tokens.length; i += step) {
    const chunk = tokens.slice(i, i + WINDOW_TOKENS).join(' ');
    if (chunk.length >= MIN_LEN) windows.push(chunk);
  }
  return windows.length ? windows : [normalized];
}

// ─────────────────────────────────────────────────────────────────────────────
// Parte segmentos que superen MAX_LEN en trozos más pequeños por oración
// ─────────────────────────────────────────────────────────────────────────────
function splitLongSegments(
  segments: string[],
  maxLen: number,
  minLen: number,
): string[] {
  const result: string[] = [];
  for (const seg of segments) {
    if (seg.length <= maxLen) {
      result.push(seg);
      continue;
    }
    // Partir por oración
    const sentences = seg
      .replace(/([.!?])\s+/g, '$1\n')
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length >= minLen);

    // Agrupar de 2 en 2
    for (let i = 0; i < sentences.length; i += 2) {
      const chunk = sentences.slice(i, i + 2).join(' ');
      if (chunk.length >= minLen) result.push(chunk);
    }
  }
  return result.length ? result : segments;
}
