import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { cleanText, splitIntoParagraphs } from './text.utils';

export type SearchQueryPlan = {
  queries: string[];
  phrases: string[];
  keywords: string[];
  concepts: string[];
  titleQuery: string | null;
};

const QUERY_BLOCKLIST = new Set([
  'universidad',
  'metropolitana',
  'facultad',
  'escuela',
  'instituto',
  'carrera',
  'ingenieria',
  'administracion',
  'ecuador',
  'quito',
  'tesis',
  'informe',
  'proyecto',
  'introduccion',
  'conclusion',
  'resumen',
  'abstract',
  'bibliografia',
  'referencias',
  'indice',
  'pagina',
  'segun',
  'donde',
  'cuando',
  'tambien',
  'ademas',
  'embargo',
  'existe',
  'pueden',
  'tiene',
  'tienen',
  'hacer',
  'parte',
  'forma',
  'medio',
  'nivel',
  'entre',
  'desde',
  'hasta',
  'sobre',
]);

const semanticIaUrl =
  process.env.SEMANTIC_IA_URL ?? 'http://127.0.0.1:5000/compare';
const queryIaEnabled = process.env.SEARCH_QUERY_IA_ENABLED !== 'false';
const maxQueries = (() => {
  const n = Number(process.env.SEARCH_MAX_QUERIES ?? '6');
  return Number.isFinite(n) && n >= 2 ? Math.min(Math.floor(n), 10) : 6;
})();

/**
 * Planifica múltiples consultas de búsqueda externa a partir del documento.
 * Complementa el pipeline existente sin reemplazar embeddings ni similitud.
 */
@Injectable()
export class SearchQueryPlannerService {
  private readonly logger = new Logger(SearchQueryPlannerService.name);

  async planQueries(fullText: string, title?: string): Promise<SearchQueryPlan> {
    const phrases = this.extractRelevantPhrases(fullText);
    const keywords = this.extractKeywords(fullText);
    const concepts = this.extractTechnicalConcepts(fullText);
    const titleQuery = this.normalizeTitleQuery(title);

    const heuristicQueries = this.buildHeuristicQueries({
      phrases,
      keywords,
      concepts,
      titleQuery,
      fullText,
    });

    const iaQueries = queryIaEnabled
      ? await this.enhanceQueriesWithSemanticHints(fullText, heuristicQueries)
      : [];

    const queries = this.uniqueQueries([
      ...iaQueries,
      ...heuristicQueries,
      ...(titleQuery ? [titleQuery] : []),
    ]).slice(0, maxQueries);

    this.logger.log(
      `Plan de búsqueda: ${queries.length} consulta(s) — frases: ${phrases.length}, keywords: ${keywords.length}, conceptos: ${concepts.length}`,
    );

    return { queries, phrases, keywords, concepts, titleQuery };
  }

  /** Compatibilidad con extractSearchQuery histórico. */
  buildLegacySingleQuery(text: string): string {
    const keywords = this.extractKeywords(text);
    return keywords.slice(0, 8).join(' ');
  }

  private extractRelevantPhrases(text: string): string[] {
    const paragraphs = splitIntoParagraphs(text);
    const substantive = paragraphs.filter((p) => p.length > 100 && p.length < 500);

    return substantive
      .map((p) => {
        const sentences = p
          .split(/(?<=[.!?])\s+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 60 && s.length < 280);
        return sentences[0] || p.slice(0, 220);
      })
      .filter(Boolean)
      .slice(0, 4)
      .map((s) => this.compressQuery(s, 120));
  }

  private extractKeywords(text: string): string[] {
    const withoutProperNouns = text
      .replace(/([.!?]\s+)[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+/g, '$1__SENT__')
      .replace(/\b[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]{2,}\b/g, '')
      .replace(/__SENT__/g, '');

    const tokens = cleanText(withoutProperNouns)
      .split(/\s+/)
      .filter((t) => t.length >= 5)
      .filter((t) => !QUERY_BLOCKLIST.has(t))
      .filter((t) => !/^\d+$/.test(t));

    const freq = new Map<string, number>();
    for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);

    const repeated = [...freq.entries()]
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t);

    const singles = [...freq.entries()]
      .filter(([, c]) => c === 1)
      .sort((a, b) => b[0].length - a[0].length)
      .map(([t]) => t);

    return [...new Set([...repeated, ...singles])].slice(0, 10);
  }

  private extractTechnicalConcepts(text: string): string[] {
    const concepts = new Set<string>();

    const patterns = [
      /\b[A-Z]{2,}(?:-[A-Z]{2,})?\b/g,
      /\b[a-z]+(?:-[a-z]+){1,3}\b/g,
      /\b\w*\d+\w*\b/g,
      /\b(?:modelo|metodologia|algoritmo|framework|sistema|analisis|implementacion|evaluacion)\s+\w+/gi,
    ];

    for (const pattern of patterns) {
      const matches = text.match(pattern) || [];
      for (const m of matches) {
        const normalized = cleanText(m);
        if (normalized.length >= 4 && normalized.length <= 40) {
          concepts.add(normalized);
        }
      }
    }

    return [...concepts].slice(0, 8);
  }

  private normalizeTitleQuery(title?: string): string | null {
    if (!title?.trim()) return null;
    const cleaned = cleanText(title);
    if (cleaned.length < 8) return null;
    return this.compressQuery(cleaned, 90);
  }

  private buildHeuristicQueries(input: {
    phrases: string[];
    keywords: string[];
    concepts: string[];
    titleQuery: string | null;
    fullText: string;
  }): string[] {
    const queries: string[] = [];

    if (input.keywords.length >= 3) {
      queries.push(input.keywords.slice(0, 5).join(' '));
      queries.push(input.keywords.slice(0, 3).join(' '));
    }

    for (const phrase of input.phrases.slice(0, 2)) {
      queries.push(phrase);
    }

    for (const concept of input.concepts.slice(0, 2)) {
      queries.push(
        input.keywords.length
          ? `${concept} ${input.keywords.slice(0, 2).join(' ')}`
          : concept,
      );
    }

    if (input.titleQuery && input.keywords.length) {
      queries.push(`${input.titleQuery} ${input.keywords.slice(0, 2).join(' ')}`);
    }

    if (!queries.length) {
      const emergency = cleanText(input.fullText)
        .split(/\s+/)
        .filter((t) => t.length >= 5)
        .slice(0, 5);
      if (emergency.length) queries.push(emergency.join(' '));
    }

    return queries.map((q) => this.compressQuery(q, 140)).filter(Boolean);
  }

  /**
   * Usa el servicio de IA existente solo para priorizar términos del texto
   * (sin modificar Flask): compara oraciones entre sí y elige las más centrales.
   */
  private async enhanceQueriesWithSemanticHints(
    fullText: string,
    seedQueries: string[],
  ): Promise<string[]> {
    try {
      const sentences = splitIntoParagraphs(fullText)
        .flatMap((p) => p.split(/(?<=[.!?])\s+/))
        .map((s) => s.trim())
        .filter((s) => s.length > 50 && s.length < 220)
        .slice(0, 6);

      if (sentences.length < 2) return [];

      const response = await axios.post(
        semanticIaUrl,
        { texto_nuevo: sentences[0], textos_base: sentences.slice(1, 4) },
        { timeout: 8000 },
      );

      const detailed = (response.data as { analisis_detallado?: Array<{ referencia?: string }> })
        .analisis_detallado;
      const refs = (detailed || [])
        .map((d) => d.referencia?.trim())
        .filter((r): r is string => !!r && r.length > 20)
        .slice(0, 2)
        .map((r) => this.compressQuery(r, 120));

      if (refs.length && seedQueries[0]) {
        return refs.map((r) => `${this.compressQuery(seedQueries[0], 60)} ${r}`.trim());
      }
      return refs;
    } catch {
      return [];
    }
  }

  private uniqueQueries(queries: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const q of queries) {
      const normalized = q.trim().toLowerCase();
      if (!normalized || normalized.length < 8 || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(q.trim());
    }
    return out;
  }

  private compressQuery(text: string, maxLen: number): string {
    const cleaned = cleanText(text);
    if (!cleaned) return '';
    const words = cleaned.split(/\s+/).filter(Boolean);
    let result = '';
    for (const w of words) {
      const next = result ? `${result} ${w}` : w;
      if (next.length > maxLen) break;
      result = next;
    }
    return result || cleaned.slice(0, maxLen);
  }
}
