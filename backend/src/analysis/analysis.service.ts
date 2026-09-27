import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { calculateSimilarity } from './similarity.service';
import { cleanText, splitIntoParagraphs } from './text.utils';
import { WebSourceService } from './web-source.service';
import { StylometryService, StylometryResult } from './stylometry.service';

export type AnalysisSource = {
  documentId: number;
  title: string;
  similarity: number;
  sourceType?: 'internal' | 'web';
  url?: string;
};

export type AnalysisMatch = {
  documentId: number;
  title: string;
  similarity: number;
  text1: string;
  text2: string;
  paragraphIndex?: number;
  sourceType?: 'internal' | 'web';
  url?: string;
};

export type AnalysisResponse = {
  message: string;
  document: {
    id: number;
    title: string;
    filePath: string;
    content: string;
    userId: number;
    createdAt: Date;
  };
  summary: AnalysisSource[];
  matches: AnalysisMatch[];
  overallSimilarity: number;
  semanticServiceStatus: 'ok' | 'degraded';
  analysisDurationMs: number;
  stylometry: StylometryResult;
};

type SourceDocument = {
  id: number;
  title: string;
  content: string | null;
  sourceType: 'internal' | 'web';
  url?: string;
};

type SourceEvidence = {
  sourceId: number;
  sourceTitle: string;
  segmentIndex: number;
  segmentText: string;
  sourceSnippet: string;
  lexicalSimilarity: number;
  semanticSimilarity: number;
  combinedSimilarity: number;
  sourceType: 'internal' | 'web';
  sourceUrl?: string;
};

const semanticIaUrl =
  process.env.SEMANTIC_IA_URL ?? 'http://127.0.0.1:5000/compare';
const semanticIaTimeoutMs = Number(
  process.env.SEMANTIC_IA_TIMEOUT_MS ?? '120000',
);
const semanticIaTimeout =
  Number.isFinite(semanticIaTimeoutMs) && semanticIaTimeoutMs > 0
    ? semanticIaTimeoutMs
    : 120000;

const semanticTopKPerSegment = (() => {
  const n = Number(process.env.SEMANTIC_TOP_K_PER_SEGMENT ?? '4');
  if (!Number.isFinite(n) || n < 1) return 4;
  return Math.min(Math.floor(n), 12);
})();

const semanticIaMaxAttempts = (() => {
  const n = Number(process.env.SEMANTIC_IA_MAX_ATTEMPTS ?? '2');
  if (!Number.isFinite(n) || n < 1) return 2;
  return Math.min(Math.floor(n), 5);
})();

const semanticIaRetryDelayMs = (() => {
  const n = Number(process.env.SEMANTIC_IA_RETRY_DELAY_MS ?? '400');
  if (!Number.isFinite(n) || n < 0) return 400;
  return Math.min(Math.floor(n), 5000);
})();

const analysisMaxSegments = (() => {
  const n = Number(process.env.ANALYSIS_MAX_SEGMENTS ?? '2000');
  if (!Number.isFinite(n) || n < 1) return 2000;
  return Math.min(Math.floor(n), 10000);
})();

const analysisMaxMatchesOut = (() => {
  const n = Number(process.env.ANALYSIS_MAX_MATCHES_OUT ?? '800');
  if (!Number.isFinite(n) || n < 1) return 800;
  return Math.min(Math.floor(n), 5000);
})();

// ── UMBRALES DIFERENCIADOS ────────────────────────────────────────────────────
// Fuentes internas: umbral más alto porque tienen texto completo
// Fuentes web: umbral más bajo porque solo tienen abstracts cortos
const THRESHOLDS = {
  internal: { lexical: 16, combined: 22 },
  web: { lexical: 8, combined: 12 },
};

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly webSourceService: WebSourceService,
    private readonly stylometryService: StylometryService,
  ) {}

  private semanticCache = new Map<string, number>();

  async analyzeDocument(documentId: number): Promise<AnalysisResponse> {
    const startedAt = Date.now();
    const semanticState = { degraded: false };

    const targetDocument = await this.prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!targetDocument) {
      throw new NotFoundException('Documento no encontrado');
    }

    const targetText = targetDocument.content?.trim() || '';
    if (!targetText) {
      throw new NotFoundException('El documento no contiene texto analizable');
    }

    // ── 1. Fuentes internas ───────────────────────────────────────────────────
    const internalDocuments = await this.prisma.document.findMany({
      where: { id: { not: documentId } },
    });

    // ── 2. Fuentes web ────────────────────────────────────────────────────────
    const webDocuments = await this.webSourceService.searchRelevantSources(
      targetText,
      { title: targetDocument.title },
    );

    this.logger.log(
      `Fuentes encontradas — internas: ${internalDocuments.length}, web: ${webDocuments.length}`,
    );

    if (webDocuments.length === 0) {
      this.logger.warn(
        'No se encontraron fuentes web. Verifica los logs de WebSourceService para diagnóstico.',
      );
    } else {
      this.logger.log(
        `Fuentes web: ${webDocuments.map((d) => `"${d.title}" (${d.provider})`).join(' | ')}`,
      );
    }

    // ── 3. Combinar y deduplicar ──────────────────────────────────────────────
    const sourceDocuments = this.deduplicateSources([
      ...internalDocuments.map((item) => ({
        id: item.id,
        title: item.title,
        content: item.content,
        sourceType: 'internal' as const,
      })),
      ...webDocuments,
    ]);

    this.logger.log(
      `Total fuentes combinadas (tras deduplicar): ${sourceDocuments.length} ` +
        `(${sourceDocuments.filter((d) => d.sourceType === 'internal').length} internas, ` +
        `${sourceDocuments.filter((d) => d.sourceType === 'web').length} web)`,
    );

    // ── 4. Estilometría solo con documentos internos ──────────────────────────
    const internalOnly = sourceDocuments.filter(
      (d) => d.sourceType === 'internal',
    );
    const stylometry = this.stylometryService.analyze(targetText, internalOnly);

    if (!sourceDocuments.length) {
      return {
        message: 'Análisis completado (sin documentos base)',
        document: {
          id: targetDocument.id,
          title: targetDocument.title,
          filePath: targetDocument.filePath,
          content: targetText,
          userId: targetDocument.userId,
          createdAt: targetDocument.createdAt,
        },
        summary: [],
        matches: [],
        overallSimilarity: 0,
        semanticServiceStatus: 'ok',
        analysisDurationMs: Date.now() - startedAt,
        stylometry,
      };
    }

    // ── 5. Segmentar y analizar ───────────────────────────────────────────────
    const segments = this.buildSegments(targetText);
    this.logger.log(
      `Análisis documento ${documentId}: ${sourceDocuments.length} fuente(s), ${segments.length} segmento(s).`,
    );

    const evidence = await this.collectEvidenceBySegment(
      segments,
      sourceDocuments,
      semanticState,
    );

    this.logger.log(
      `Evidencias recolectadas: ${evidence.length} ` +
        `(${evidence.filter((e) => e.sourceType === 'web').length} de fuentes web)`,
    );

    const summary = this.buildSourceRanking(segments, evidence);
    const matches = this.buildMatchesFromEvidence(evidence);
    const overallSimilarity = summary.length
      ? this.round(
          summary.reduce((acc, item) => acc + item.similarity, 0) /
            summary.length,
        )
      : 0;

    return {
      message: 'Análisis de similitud completado',
      document: {
        id: targetDocument.id,
        title: targetDocument.title,
        filePath: targetDocument.filePath,
        content: targetText,
        userId: targetDocument.userId,
        createdAt: targetDocument.createdAt,
      },
      summary,
      matches,
      overallSimilarity,
      semanticServiceStatus: semanticState.degraded ? 'degraded' : 'ok',
      analysisDurationMs: Date.now() - startedAt,
      stylometry,
    };
  }

  /**
   * Extrae un fragmento representativo del texto ignorando los primeros párrafos
   * (que suelen ser encabezados institucionales) para mejorar la query de búsqueda web.
   */
  private extractRepresentativeText(text: string): string {
    const paragraphs = splitIntoParagraphs(text);

    // Saltar los primeros párrafos cortos (encabezados, portada, índice)
    const substantiveParagraphs = paragraphs.filter((p) => p.length > 120);

    if (!substantiveParagraphs.length) return text.slice(0, 1200);

    // Tomar desde el primer párrafo sustantivo, máximo 1200 caracteres
    return substantiveParagraphs.slice(0, 4).join(' ').slice(0, 1200);
  }

  private buildSegments(targetText: string): string[] {
    const byParagraph = splitIntoParagraphs(targetText);
    const maxSegments = analysisMaxSegments;

    if (byParagraph.length) {
      if (byParagraph.length > maxSegments) {
        this.logger.warn(
          `Texto partido en ${byParagraph.length} segmentos; se analizan los primeros ${maxSegments}.`,
        );
      }
      return byParagraph.slice(0, maxSegments);
    }

    const fallback = targetText
      .split(/(?<=[.!?])\s+/)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length >= 25);

    if (fallback.length > maxSegments) {
      this.logger.warn(
        `Fallback por oraciones: ${fallback.length} trozos; se analizan ${maxSegments}.`,
      );
    }
    return fallback.slice(0, maxSegments);
  }

  private async collectEvidenceBySegment(
    segments: string[],
    sourceDocuments: SourceDocument[],
    semanticState: { degraded: boolean },
  ): Promise<SourceEvidence[]> {
    const evidence: SourceEvidence[] = [];

    for (
      let segmentIndex = 0;
      segmentIndex < segments.length;
      segmentIndex += 1
    ) {
      const segment = segments[segmentIndex];
      let bestForSegment: SourceEvidence | null = null;

      const lexicalRanked: {
        sourceDocument: SourceDocument;
        lexicalSimilarity: number;
        sourceText: string;
      }[] = [];

      for (const sourceDocument of sourceDocuments) {
        const sourceText = sourceDocument.content?.trim() || '';
        if (!sourceText) continue;

        const threshold =
          THRESHOLDS[sourceDocument.sourceType] ?? THRESHOLDS.internal;

        // Para fuentes web: comparar el segmento contra cada oración del abstract
        // en lugar del abstract completo (mejora la precisión con textos cortos)
        const lexicalSimilarity =
          sourceDocument.sourceType === 'web'
            ? this.calculateSimilarityAgainstBestChunk(segment, sourceText)
            : calculateSimilarity(segment, sourceText);

        if (lexicalSimilarity < threshold.lexical) continue;
        lexicalRanked.push({ sourceDocument, lexicalSimilarity, sourceText });
      }

      lexicalRanked.sort((a, b) => b.lexicalSimilarity - a.lexicalSimilarity);
      const candidatesForSemantic = lexicalRanked.slice(
        0,
        semanticTopKPerSegment,
      );

      for (const {
        sourceDocument,
        lexicalSimilarity,
        sourceText,
      } of candidatesForSemantic) {
        const semanticSimilarity = await this.getSemanticSimilarity(
          segment,
          sourceText,
          semanticState,
        );
        const combinedSimilarity = this.round(
          lexicalSimilarity * 0.55 + semanticSimilarity * 0.45,
        );

        const threshold =
          THRESHOLDS[sourceDocument.sourceType] ?? THRESHOLDS.internal;
        if (combinedSimilarity < threshold.combined) continue;

        const candidate: SourceEvidence = {
          sourceId: sourceDocument.id,
          sourceTitle: sourceDocument.title,
          segmentIndex,
          segmentText: segment,
          sourceSnippet: this.extractBestSnippet(sourceText, segment),
          lexicalSimilarity: this.round(lexicalSimilarity),
          semanticSimilarity: this.round(semanticSimilarity),
          combinedSimilarity,
          sourceType: sourceDocument.sourceType,
          sourceUrl: sourceDocument.url,
        };

        if (
          !bestForSegment ||
          candidate.combinedSimilarity > bestForSegment.combinedSimilarity
        ) {
          bestForSegment = candidate;
        }
      }

      if (bestForSegment) {
        evidence.push(bestForSegment);
      }
    }

    return evidence;
  }

  /**
   * Para fuentes web con abstracts cortos: divide el source en chunks de 3 oraciones
   * y devuelve la similitud máxima encontrada contra cualquiera de ellos.
   * Evita que un abstract de 200 palabras "diluya" la similitud contra un segmento largo.
   */
  private calculateSimilarityAgainstBestChunk(
    segment: string,
    sourceText: string,
  ): number {
    const sentences = sourceText
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 20);

    if (sentences.length <= 3) {
      return calculateSimilarity(segment, sourceText);
    }

    let best = 0;
    const chunkSize = 3;
    for (let i = 0; i < sentences.length; i += chunkSize) {
      const chunk = sentences.slice(i, i + chunkSize).join(' ');
      const sim = calculateSimilarity(segment, chunk);
      if (sim > best) best = sim;
    }
    return best;
  }

  private buildSourceRanking(
    segments: string[],
    evidence: SourceEvidence[],
  ): AnalysisSource[] {
    if (!evidence.length || !segments.length) return [];

    const evidenceBySource = new Map<number, SourceEvidence[]>();
    for (const item of evidence) {
      const current = evidenceBySource.get(item.sourceId) || [];
      current.push(item);
      evidenceBySource.set(item.sourceId, current);
    }

    const ranking: AnalysisSource[] = [];
    evidenceBySource.forEach((items, sourceId) => {
      const sourceTitle = items[0]?.sourceTitle || `Fuente ${sourceId}`;
      const avgSegmentSimilarity =
        items.reduce((acc, item) => acc + item.combinedSimilarity, 0) /
        items.length;
      const coverage = (items.length / segments.length) * 100;
      const matchDensity = Math.min((items.length / 12) * 100, 100);

      const sourceScore =
        coverage * 0.5 + avgSegmentSimilarity * 0.35 + matchDensity * 0.15;

      ranking.push({
        documentId: sourceId,
        title: sourceTitle,
        similarity: this.round(sourceScore),
        sourceType: items[0]?.sourceType || 'internal',
        url: items[0]?.sourceUrl,
      });
    });

    ranking.sort((a, b) => b.similarity - a.similarity);
    return ranking;
  }

  private buildMatchesFromEvidence(
    evidence: SourceEvidence[],
  ): AnalysisMatch[] {
    return evidence
      .sort((a, b) => b.combinedSimilarity - a.combinedSimilarity)
      .slice(0, analysisMaxMatchesOut)
      .map((item) => ({
        documentId: item.sourceId,
        title: item.sourceTitle,
        similarity: item.combinedSimilarity,
        text1: item.segmentText,
        text2: item.sourceSnippet,
        paragraphIndex: item.segmentIndex,
        sourceType: item.sourceType,
        url: item.sourceUrl,
      }));
  }

  private extractBestSnippet(sourceText: string, segment: string): string {
    const normalizedSegment = cleanText(segment);
    const segmentTokens = normalizedSegment
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 6);

    const rawSentences = sourceText
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 20);

    if (!rawSentences.length) return sourceText.slice(0, 220);

    let bestSentence = rawSentences[0];
    let bestScore = -1;

    for (const sentence of rawSentences.slice(0, 40)) {
      const normalizedSentence = cleanText(sentence);
      if (!normalizedSentence) continue;

      const lexical = calculateSimilarity(segment, sentence);
      const tokenBonus = segmentTokens.reduce((acc, token) => {
        if (token.length < 4) return acc;
        return normalizedSentence.includes(token) ? acc + 1 : acc;
      }, 0);

      const score = lexical + tokenBonus * 2;
      if (score > bestScore) {
        bestScore = score;
        bestSentence = sentence;
      }
    }

    if (bestScore < 0) return cleanText(sourceText).slice(0, 220);
    return bestSentence.slice(0, 240);
  }

  private async getSemanticSimilarity(
    text1: string,
    text2: string,
    semanticState: { degraded: boolean },
  ): Promise<number> {
    const cacheKey = `${this.shortenForCache(text1)}::${this.shortenForCache(text2)}`;
    const cached = this.semanticCache.get(cacheKey);
    if (cached !== undefined) return cached;

    let lastError: unknown;
    for (let attempt = 1; attempt <= semanticIaMaxAttempts; attempt += 1) {
      try {
        const response = await axios.post(
          semanticIaUrl,
          { texto_nuevo: text1, textos_base: [text2] },
          { timeout: semanticIaTimeout },
        );

        const payload = response.data as { similitud_ia?: number };
        const similarity = this.round(payload.similitud_ia || 0);
        this.semanticCache.set(cacheKey, similarity);
        if (attempt > 1) {
          this.logger.log(
            `IA semántica: OK en intento ${attempt}/${semanticIaMaxAttempts}`,
          );
        }
        return similarity;
      } catch (error) {
        lastError = error;
        const msg = error instanceof Error ? error.message : String(error);
        if (attempt < semanticIaMaxAttempts) {
          this.logger.warn(
            `IA semántica falló (intento ${attempt}/${semanticIaMaxAttempts}): ${msg}. Reintento en ${semanticIaRetryDelayMs}ms`,
          );
          await this.delay(semanticIaRetryDelayMs);
        }
      }
    }

    const finalMsg =
      lastError instanceof Error ? lastError.message : String(lastError);
    this.logger.warn(
      `IA semántica no respondió tras ${semanticIaMaxAttempts} intento(s): ${finalMsg}`,
    );
    this.semanticCache.set(cacheKey, 0);
    semanticState.degraded = true;
    return 0;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private shortenForCache(text: string): string {
    return cleanText(text).slice(0, 280);
  }

  private deduplicateSources(sources: SourceDocument[]): SourceDocument[] {
    const unique = new Map<string, SourceDocument>();
    for (const source of sources) {
      const content = source.content?.trim() || '';
      if (!content) continue;
      const fingerprint = `${cleanText(source.title).slice(0, 40)}::${cleanText(content).slice(0, 220)}`;
      if (!unique.has(fingerprint)) {
        unique.set(fingerprint, source);
      }
    }
    return Array.from(unique.values());
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
