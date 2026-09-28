import { Injectable } from '@nestjs/common';

// ─────────────────────────────────────────────
// TIPOS PÚBLICOS
// ─────────────────────────────────────────────

/** Huella estilométrica de un texto */
export type StyleProfile = {
  avgSentenceLength: number; // promedio de palabras por oración
  avgWordLength: number; // promedio de letras por palabra
  vocabularyRichness: number; // TTR promedio en bloques de 100 palabras (0-100)
  punctuationDensity: number; // signos de puntuación cada 100 palabras
  connectorUsage: number; // conectores lógicos cada 100 palabras
  passiveVoiceRatio: number; // oraciones con indicios de voz pasiva (0-100)
  avgParagraphLength: number; // oraciones por párrafo (0 = no disponible)
};

/** Segmento que rompe el estilo del autor */
export type StyleAnomaly = {
  segmentIndex: number;
  segmentText: string;
  deviation: number; // qué tan diferente es del estilo habitual del documento (0-100)
  reason: string; // explicación legible
};

/** Resultado del análisis estilométrico de autoría entre dos documentos */
export type AuthorshipMatch = {
  documentId: number;
  title: string;
  styleScore: number; // similitud estilométrica (0-100)
  sameAuthorLikelihood: 'alta' | 'media' | 'baja';
};

/** Resultado completo que se agrega al AnalysisResponse */
export type StylometryResult = {
  profile: StyleProfile; // perfil del documento analizado
  anomalies: StyleAnomaly[]; // segmentos que rompen el estilo
  authorshipMatches: AuthorshipMatch[]; // comparación con documentos de la BD
  consistencyScore: number; // consistencia interna (0-100)
};

// ─────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────

/** Conectores lógicos comunes en español académico */
const CONNECTORS = [
  'sin embargo',
  'por lo tanto',
  'en consecuencia',
  'asimismo',
  'además',
  'no obstante',
  'por otro lado',
  'en cambio',
  'debido a',
  'dado que',
  'puesto que',
  'por ende',
  'en efecto',
  'es decir',
  'por consiguiente',
  'así mismo',
  'de esta manera',
  'en este sentido',
  'cabe destacar',
];

/**
 * Indicios de voz pasiva en español.
 * - Sin la bandera /g: con /g, .test() recuerda la última posición (lastIndex)
 *   y da resultados distintos para la misma oración.
 * - Con \p{L} en lugar de \w para reconocer letras con tilde (realizó, definió).
 */
const L = '\\p{L}';
const PARTICIPLE = `${L}+(?:ado|ido|ada|ida)s?`;
const PASSIVE_PATTERNS = [
  new RegExp(`(?<!${L})(?:fue|fueron|es|son|será|serán)\\s+${PARTICIPLE}(?!${L})`, 'iu'),
  new RegExp(`(?<!${L})(?:ha|han|había|habían)\\s+sido(?!${L})`, 'iu'),
  new RegExp(`(?<!${L})se\\s+${L}+(?:a|e|an|en|ó|ió|aron|ieron)(?!${L})`, 'iu'),
];

/** Palabras aproximadas por segmento al buscar anomalías. */
const SEGMENT_WORDS = 150;
/** Mínimo de segmentos para que tenga sentido hablar de anomalías. */
const MIN_SEGMENTS = 4;
/** Desviación mínima (0-100) para marcar un segmento como anómalo. */
const DEVIATION_THRESHOLD = 30;
/** Tamaño del bloque para la riqueza de vocabulario. */
const TTR_BLOCK = 100;
/**
 * Filtros de texto que no es prosa (tablas, listas de referencias):
 * - más del 10 % de las palabras contienen dígitos (años, páginas, DOI), o
 * - "oraciones" de más de 60 palabras (celdas de tabla sin puntuación).
 * Estos segmentos no se comparan: su estilo diferente no indica otro autor.
 */
const MAX_DIGIT_TOKEN_RATIO = 0.1;
const MAX_PROSE_SENTENCE_LENGTH = 60;

type MetricKey = keyof StyleProfile;

const WEIGHTS: Record<MetricKey, number> = {
  avgSentenceLength: 0.2,
  avgWordLength: 0.15,
  vocabularyRichness: 0.2,
  punctuationDensity: 0.15,
  connectorUsage: 0.15,
  passiveVoiceRatio: 0.1,
  avgParagraphLength: 0.05,
};

/** Rangos máximos esperados para normalizar cada métrica */
const RANGES: Record<MetricKey, number> = {
  avgSentenceLength: 40,
  avgWordLength: 8,
  vocabularyRichness: 100,
  punctuationDensity: 30,
  connectorUsage: 10,
  passiveVoiceRatio: 60,
  avgParagraphLength: 20,
};

// ─────────────────────────────────────────────
// SERVICIO
// ─────────────────────────────────────────────

@Injectable()
export class StylometryService {
  // ── MÉTODO PRINCIPAL ──────────────────────

  /**
   * Analiza la estilometría de un documento.
   * @param targetText       Texto del documento a analizar
   * @param sourceDocuments  Documentos internos de la BD para comparar autoría
   */
  analyze(
    targetText: string,
    sourceDocuments: { id: number; title: string; content: string | null }[],
  ): StylometryResult {
    // 1. Perfil del documento analizado
    const profile = this.extractProfile(targetText);

    // 2. Segmentos que rompen el estilo del propio documento
    const anomalies = this.detectAnomalies(targetText);

    // 3. Comparación con documentos internos de la BD
    const authorshipMatches = sourceDocuments
      .filter((doc) => doc.content && doc.content.trim().length > 100)
      .map((doc) => {
        const sourceProfile = this.extractProfile(doc.content!);
        const styleScore = this.compareProfiles(profile, sourceProfile);
        return {
          documentId: doc.id,
          title: doc.title,
          styleScore: this.round(styleScore),
          sameAuthorLikelihood: this.getLikelihood(styleScore),
        } as AuthorshipMatch;
      })
      .sort((a, b) => b.styleScore - a.styleScore)
      .slice(0, 5); // top 5 más similares

    // 4. Consistencia interna (100 = muy consistente, 0 = muy inconsistente)
    const consistencyScore =
      anomalies.length === 0
        ? 100
        : this.round(
            Math.max(
              0,
              100 -
                anomalies.reduce((acc, a) => acc + a.deviation, 0) /
                  anomalies.length,
            ),
          );

    return { profile, anomalies, authorshipMatches, consistencyScore };
  }

  // ── EXTRACCIÓN DE PERFIL ──────────────────

  /**
   * Extrae la huella estilométrica de un texto (7 métricas).
   */
  extractProfile(text: string): StyleProfile {
    return this.profileFromSentences(
      this.splitSentences(text),
      this.countParagraphs(text),
    );
  }

  private profileFromSentences(
    sentences: string[],
    paragraphCount: number,
  ): StyleProfile {
    const text = sentences.join(' ');
    const words = this.getWords(text);

    // Métrica 1: promedio de palabras por oración
    const avgSentenceLength =
      sentences.length > 0 ? words.length / sentences.length : 0;

    // Métrica 2: promedio de letras por palabra
    const avgWordLength =
      words.length > 0
        ? words.reduce((acc, w) => acc + w.length, 0) / words.length
        : 0;

    // Métrica 3: riqueza de vocabulario, medida en bloques de igual tamaño
    // para que no dependa de la longitud del texto.
    const vocabularyRichness = this.blockTypeTokenRatio(words);

    // Métrica 4: densidad de puntuación (signos cada 100 palabras)
    const punctuationCount = (text.match(/[.,;:!?()"\-—]/g) || []).length;
    const punctuationDensity =
      words.length > 0 ? (punctuationCount / words.length) * 100 : 0;

    // Métrica 5: uso de conectores lógicos cada 100 palabras
    const lowerText = text.toLowerCase();
    const connectorCount = CONNECTORS.reduce(
      (acc, connector) => acc + (lowerText.split(connector).length - 1),
      0,
    );
    const connectorUsage =
      words.length > 0 ? (connectorCount / words.length) * 100 : 0;

    // Métrica 6: porcentaje de oraciones con indicios de voz pasiva
    const passiveSentences = sentences.filter((s) =>
      PASSIVE_PATTERNS.some((pattern) => pattern.test(s)),
    ).length;
    const passiveVoiceRatio =
      sentences.length > 0 ? (passiveSentences / sentences.length) * 100 : 0;

    // Métrica 7: oraciones por párrafo. Solo existe si el texto conserva
    // párrafos (el texto extraído de PDF normalmente no los tiene): 0 = no disponible.
    const avgParagraphLength =
      paragraphCount >= 2 ? sentences.length / paragraphCount : 0;

    return {
      avgSentenceLength: this.round(avgSentenceLength),
      avgWordLength: this.round(avgWordLength),
      vocabularyRichness: this.round(vocabularyRichness),
      punctuationDensity: this.round(punctuationDensity),
      connectorUsage: this.round(connectorUsage),
      passiveVoiceRatio: this.round(passiveVoiceRatio),
      avgParagraphLength: this.round(avgParagraphLength),
    };
  }

  // ── COMPARACIÓN DE PERFILES ───────────────

  /**
   * Compara dos perfiles estilométricos. Devuelve similitud de 0 a 100.
   * Distancia ponderada y normalizada sobre las métricas disponibles:
   * si una métrica no existe en alguno de los dos perfiles (valor 0 en
   * avgParagraphLength), se excluye y se reparten los pesos restantes.
   */
  compareProfiles(profileA: StyleProfile, profileB: StyleProfile): number {
    let weightedDistance = 0;
    let totalWeight = 0;

    (Object.keys(WEIGHTS) as MetricKey[]).forEach((key) => {
      if (
        key === 'avgParagraphLength' &&
        (profileA[key] === 0 || profileB[key] === 0)
      ) {
        return;
      }
      const diff = Math.abs(profileA[key] - profileB[key]);
      const normalizedDiff = Math.min(diff / RANGES[key], 1); // 0 = igual, 1 = máximo diferente
      weightedDistance += normalizedDiff * WEIGHTS[key];
      totalWeight += WEIGHTS[key];
    });

    if (totalWeight === 0) return 0;
    return Math.max(0, (1 - weightedDistance / totalWeight) * 100);
  }

  // ── DETECCIÓN DE ANOMALÍAS ────────────────

  /**
   * Divide el documento en segmentos de ~150 palabras (oraciones completas),
   * calcula el estilo habitual del documento como la mediana de los segmentos
   * y marca los segmentos que se alejan de ese estilo.
   *
   * Comparar segmentos contra segmentos (y no contra el documento entero)
   * evita que métricas sensibles a la longitud, como la riqueza de
   * vocabulario, marquen todos los segmentos como anómalos.
   */
  private detectAnomalies(text: string): StyleAnomaly[] {
    const prose = this.buildSegments(this.splitSentences(text))
      .map((sentences, index) => ({
        index,
        sentences,
        profile: this.profileFromSentences(sentences, 0),
      }))
      .filter((segment) => this.isProse(segment.sentences, segment.profile));
    if (prose.length < MIN_SEGMENTS) return [];

    const baseline = this.medianProfile(prose.map((s) => s.profile));

    const anomalies: StyleAnomaly[] = [];
    prose.forEach(({ index, sentences, profile: segmentProfile }) => {
      const deviation = 100 - this.compareProfiles(baseline, segmentProfile);
      if (deviation >= DEVIATION_THRESHOLD) {
        const segmentText = sentences.join(' ');
        anomalies.push({
          segmentIndex: index,
          segmentText:
            segmentText.slice(0, 200) + (segmentText.length > 200 ? '…' : ''),
          deviation: this.round(deviation),
          reason: this.buildAnomalyReason(baseline, segmentProfile),
        });
      }
    });

    // Ordenar por mayor desviación
    return anomalies.sort((a, b) => b.deviation - a.deviation).slice(0, 10);
  }

  /** Agrupa oraciones consecutivas hasta completar ~SEGMENT_WORDS palabras. */
  private buildSegments(sentences: string[]): string[][] {
    const segments: string[][] = [];
    let current: string[] = [];
    let currentWords = 0;

    for (const sentence of sentences) {
      current.push(sentence);
      currentWords += this.getWords(sentence).length;
      if (currentWords >= SEGMENT_WORDS) {
        segments.push(current);
        current = [];
        currentWords = 0;
      }
    }

    // El resto se une al último segmento si es muy corto
    if (current.length > 0) {
      if (currentWords < SEGMENT_WORDS / 2 && segments.length > 0) {
        segments[segments.length - 1].push(...current);
      } else {
        segments.push(current);
      }
    }
    return segments;
  }

  /** true si el segmento parece prosa (no tabla ni lista de referencias). */
  private isProse(sentences: string[], profile: StyleProfile): boolean {
    if (profile.avgSentenceLength > MAX_PROSE_SENTENCE_LENGTH) return false;
    const tokens = sentences.join(' ').split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;
    const withDigits = tokens.filter((t) => /\d/.test(t)).length;
    return withDigits / tokens.length <= MAX_DIGIT_TOKEN_RATIO;
  }

  private medianProfile(profiles: StyleProfile[]): StyleProfile {
    const median = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    };
    const result = {} as StyleProfile;
    (Object.keys(WEIGHTS) as MetricKey[]).forEach((key) => {
      result[key] = this.round(median(profiles.map((p) => p[key])));
    });
    return result;
  }

  /**
   * Genera una explicación legible de por qué un segmento es anómalo.
   */
  private buildAnomalyReason(base: StyleProfile, segment: StyleProfile): string {
    const reasons: string[] = [];

    if (Math.abs(segment.avgSentenceLength - base.avgSentenceLength) > 8) {
      const dir =
        segment.avgSentenceLength > base.avgSentenceLength
          ? 'más largas'
          : 'más cortas';
      reasons.push(`oraciones ${dir} de lo habitual`);
    }
    if (Math.abs(segment.avgWordLength - base.avgWordLength) > 1) {
      const dir =
        segment.avgWordLength > base.avgWordLength ? 'más largas' : 'más cortas';
      reasons.push(`palabras ${dir} de lo habitual`);
    }
    if (Math.abs(segment.vocabularyRichness - base.vocabularyRichness) > 10) {
      const dir =
        segment.vocabularyRichness > base.vocabularyRichness ? 'mayor' : 'menor';
      reasons.push(`${dir} variedad de vocabulario`);
    }
    if (Math.abs(segment.connectorUsage - base.connectorUsage) > 1.5) {
      const dir = segment.connectorUsage > base.connectorUsage ? 'más' : 'menos';
      reasons.push(`usa ${dir} conectores lógicos`);
    }
    if (Math.abs(segment.passiveVoiceRatio - base.passiveVoiceRatio) > 20) {
      const dir =
        segment.passiveVoiceRatio > base.passiveVoiceRatio ? 'más' : 'menos';
      reasons.push(`${dir} voz pasiva de lo habitual`);
    }
    if (Math.abs(segment.punctuationDensity - base.punctuationDensity) > 8) {
      const dir =
        segment.punctuationDensity > base.punctuationDensity ? 'mayor' : 'menor';
      reasons.push(`${dir} densidad de puntuación`);
    }

    return reasons.length > 0
      ? `Posible cambio de autor: ${reasons.join(', ')}.`
      : 'Estilo significativamente diferente al resto del documento.';
  }

  // ── UTILIDADES ────────────────────────────

  private splitSentences(text: string): string[] {
    return text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 10);
  }

  private getWords(text: string): string[] {
    return text
      .replace(/[^\wáéíóúüñÁÉÍÓÚÜÑ\s]/gi, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1);
  }

  /**
   * Riqueza de vocabulario (type-token ratio) promediada en bloques de
   * TTR_BLOCK palabras. Así un documento largo y uno corto son comparables.
   */
  private blockTypeTokenRatio(words: string[]): number {
    if (words.length === 0) return 0;
    const lower = words.map((w) => w.toLowerCase());
    if (lower.length < TTR_BLOCK) {
      return (new Set(lower).size / lower.length) * 100;
    }
    const ratios: number[] = [];
    for (let i = 0; i + TTR_BLOCK <= lower.length; i += TTR_BLOCK) {
      const block = lower.slice(i, i + TTR_BLOCK);
      ratios.push((new Set(block).size / TTR_BLOCK) * 100);
    }
    return ratios.reduce((a, b) => a + b, 0) / ratios.length;
  }

  /** Cuenta párrafos separados por línea en blanco (0 si el texto no los tiene). */
  private countParagraphs(text: string): number {
    const paragraphs = text
      .replace(/\r\n/g, '\n')
      .split(/\n\s*\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 30);
    return paragraphs.length >= 2 ? paragraphs.length : 0;
  }

  private getLikelihood(score: number): 'alta' | 'media' | 'baja' {
    if (score >= 70) return 'alta';
    if (score >= 45) return 'media';
    return 'baja';
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
