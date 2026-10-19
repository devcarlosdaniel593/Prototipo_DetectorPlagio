import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { calculateSimilarity } from './similarity.service';
import { cleanText, splitIntoParagraphs } from './text.utils';
import { WebSourceService } from './web-source.service';
import { StylometryService, StylometryResult } from './stylometry.service';

/**
 * Fuente con evidencia en el documento analizado (una fila del ranking).
 * `similarity` es el puntaje por fuente (0–100) calculado en buildSourceRanking.
 * En fuentes web `documentId` es un número negativo derivado de un hash.
 */
export type AnalysisSource = {
  documentId: number;
  title: string;
  similarity: number;
  sourceType?: 'internal' | 'web';
  url?: string;
};

/**
 * Coincidencia entre un segmento del documento (`text1`) y el fragmento más
 * parecido de la fuente (`text2`). `similarity` es la similitud combinada.
 */
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

/**
 * Respuesta completa del análisis que reciben el frontend y
 * DocumentAnalysisService. `overallSimilarity` es el promedio de los puntajes
 * de `summary`; `semanticServiceStatus` es 'degraded' si alguna llamada al
 * microservicio semántico falló tras agotar los reintentos.
 */
export type AnalysisResponse = {
  message: string;
  document: {
    id: number;
    title: string;
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

/** Fuente normalizada (interna o web) contra la que se compara cada segmento. */
type SourceDocument = {
  id: number;
  title: string;
  content: string | null;
  sourceType: 'internal' | 'web';
  url?: string;
};

/** Mejor coincidencia encontrada para un segmento, con sus tres similitudes. */
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

// ── Configuración por variables de entorno ───────────────────────────────────
// Cada valor se valida y, si es inválido, se usa el valor por defecto.
// Los máximos acotan el costo del análisis.
//   SEMANTIC_IA_URL             URL del endpoint /compare del microservicio Flask
//   SEMANTIC_IA_TIMEOUT_MS      tiempo máximo por llamada (por defecto 120 000)
//   SEMANTIC_TOP_K_PER_SEGMENT  candidatos léxicos por segmento que pasan al
//                               análisis semántico (por defecto 4, máx. 12)
//   SEMANTIC_IA_MAX_ATTEMPTS    intentos por llamada (por defecto 2, máx. 5)
//   SEMANTIC_IA_RETRY_DELAY_MS  espera entre intentos (por defecto 400 ms)
//   ANALYSIS_MAX_SEGMENTS       segmentos analizados por documento (por defecto 2000)
//   SEMANTIC_CACHE_MAX_ENTRIES  tamaño de la caché semántica (por defecto 5000)
//   ANALYSIS_MAX_MATCHES_OUT    coincidencias devueltas (por defecto 800)
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

/** Máximo de pares (segmento, fuente) guardados en la caché semántica. */
const semanticCacheMaxEntries = (() => {
  const n = Number(process.env.SEMANTIC_CACHE_MAX_ENTRIES ?? '5000');
  if (!Number.isFinite(n) || n < 100) return 5000;
  return Math.min(Math.floor(n), 50000);
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

/**
 * Servicio central del análisis de similitud de un documento.
 *
 * Combina dos medidas por segmento:
 *  - léxica: TF-IDF + coseno (similarity.service.ts), calculada localmente;
 *  - semántica: embeddings de oraciones, calculada por el microservicio Flask
 *    (ia_service/ia_service.py) mediante HTTP POST a SEMANTIC_IA_URL.
 * Además ejecuta la estilometría (StylometryService) y obtiene fuentes web
 * académicas (WebSourceService).
 *
 * Los resultados son indicadores de similitud textual para apoyar la revisión
 * del docente; no constituyen por sí solos una determinación de plagio.
 */
@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly webSourceService: WebSourceService,
    private readonly stylometryService: StylometryService,
  ) {}

  /**
   * Caché de similitud semántica por par (segmento, fuente).
   * - La clave es un hash SHA-256 del texto completo: antes se usaban los
   *   primeros 280 caracteres y dos documentos con la misma portada chocaban.
   * - Tiene tamaño máximo (se descarta el par usado hace más tiempo).
   * - Solo guarda respuestas válidas: si el microservicio falla no se guarda 0.
   */
  private readonly semanticCache = new Map<string, number>();

  /**
   * Analiza un documento ya guardado en la base de datos.
   *
   * Flujo:
   *  1. Lee el documento; las fuentes internas son todos los demás documentos
   *     de la tabla Document.
   *  2. Busca fuentes web a partir del texto y el título.
   *  3. Une ambas listas y elimina duplicados (deduplicateSources).
   *  4. Ejecuta la estilometría contra las fuentes internas únicamente.
   *  5. Segmenta el texto, recoge la mejor evidencia por segmento
   *     (collectEvidenceBySegment) y construye el ranking de fuentes y la
   *     lista de coincidencias.
   *  6. overallSimilarity = promedio simple de los puntajes por fuente.
   *
   * Solo lee de la base de datos; la persistencia de métricas la hace
   * DocumentAnalysisService. Produce llamadas HTTP a proveedores externos y
   * al microservicio semántico.
   *
   * @param documentId Id del documento en la tabla Document.
   * @returns Resultado del análisis (AnalysisResponse).
   * @throws NotFoundException si el documento no existe o no tiene texto.
   */
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
      select: { id: true, title: true, content: true },
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
   * Segmenta el texto con splitIntoParagraphs y limita el resultado a
   * ANALYSIS_MAX_SEGMENTS. Si splitIntoParagraphs no devuelve segmentos, usa
   * las oraciones de al menos 25 caracteres.
   */
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

  /**
   * Recorre los segmentos y obtiene, para cada uno, la fuente más parecida.
   *
   * Por segmento:
   *  1. Calcula la similitud léxica contra cada fuente (en fuentes web, contra
   *     el mejor bloque de 3 oraciones) y descarta las que no alcanzan el
   *     umbral léxico de su tipo (THRESHOLDS).
   *  2. Ordena las restantes y envía solo las SEMANTIC_TOP_K_PER_SEGMENT
   *     mejores al microservicio semántico (las llamadas son secuenciales).
   *  3. combinada = 0,55 · léxica + 0,45 · semántica; descarta las que no
   *     alcanzan el umbral combinado de su tipo.
   *  4. Conserva solo la fuente con mayor similitud combinada.
   *
   * Como el análisis semántico solo se aplica a candidatos que superaron el
   * filtro léxico, una paráfrasis con poco vocabulario en común con la fuente
   * no llega a evaluarse semánticamente.
   *
   * @param semanticState Se marca degraded = true si alguna llamada semántica falla.
   * @returns Como máximo una evidencia por segmento.
   */
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

  /**
   * Agrupa la evidencia por fuente y calcula su puntaje (0–100):
   *   cobertura   = segmentos con evidencia de la fuente / total de segmentos × 100
   *   media       = promedio de la similitud combinada de esos segmentos
   *   densidad    = min(segmentos con evidencia / 12 × 100, 100)
   *   puntaje     = 0,5 · cobertura + 0,35 · media + 0,15 · densidad
   * Devuelve las fuentes ordenadas de mayor a menor puntaje.
   */
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

  /**
   * Convierte la evidencia en coincidencias para la interfaz, ordenadas por
   * similitud combinada y limitadas a ANALYSIS_MAX_MATCHES_OUT.
   * Nota: Array.prototype.sort ordena `evidence` en el mismo arreglo.
   */
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

  /**
   * Elige la oración de la fuente que mejor representa la coincidencia, para
   * mostrarla junto al segmento. Revisa hasta 40 oraciones de más de 20
   * caracteres y puntúa cada una con su similitud léxica más 2 puntos por cada
   * una de las primeras 6 palabras normalizadas del segmento (de al menos 4
   * letras) que contenga. Devuelve como máximo 240 caracteres.
   */
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

  /**
   * Obtiene la similitud semántica (0–100) entre un segmento y una fuente.
   *
   * Consulta primero la caché; si no hay valor, llama a POST SEMANTIC_IA_URL
   * con { texto_nuevo, textos_base: [fuente] } y usa `similitud_ia` de la
   * respuesta. Reintenta hasta SEMANTIC_IA_MAX_ATTEMPTS veces con una espera
   * fija entre intentos. Si todos fallan, devuelve 0 y marca el análisis como
   * degradado; en ese caso la similitud combinada queda solo con el aporte
   * léxico (0,55 · léxica).
   */
  private async getSemanticSimilarity(
    text1: string,
    text2: string,
    semanticState: { degraded: boolean },
  ): Promise<number> {
    const cacheKey = `${this.hashForCache(text1)}:${this.hashForCache(text2)}`;
    const cached = this.readSemanticCache(cacheKey);
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
        this.writeSemanticCache(cacheKey, similarity);
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
    // No se guarda en caché: el próximo análisis volverá a intentarlo.
    semanticState.degraded = true;
    return 0;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** SHA-256 del texto normalizado con cleanText (clave de la caché semántica). */
  private hashForCache(text: string): string {
    return createHash('sha256').update(cleanText(text), 'utf8').digest('hex');
  }

  /**
   * La caché usa el orden de inserción de Map como orden de uso (LRU):
   * leer una entrada la mueve al final y escribir descarta las del inicio.
   */
  private readSemanticCache(key: string): number | undefined {
    const value = this.semanticCache.get(key);
    if (value === undefined) return undefined;
    // Se reinserta para marcarlo como usado recientemente
    this.semanticCache.delete(key);
    this.semanticCache.set(key, value);
    return value;
  }

  private writeSemanticCache(key: string, value: number): void {
    this.semanticCache.set(key, value);
    while (this.semanticCache.size > semanticCacheMaxEntries) {
      const oldestKey = this.semanticCache.keys().next().value;
      if (oldestKey === undefined) break;
      this.semanticCache.delete(oldestKey);
    }
  }

  /**
   * Elimina fuentes sin contenido y las repetidas. Dos fuentes se consideran
   * iguales si coinciden los primeros 40 caracteres del título y los primeros
   * 220 del contenido, ambos normalizados. Se conserva la primera aparición
   * (las internas van antes que las web en la lista de entrada).
   */
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
