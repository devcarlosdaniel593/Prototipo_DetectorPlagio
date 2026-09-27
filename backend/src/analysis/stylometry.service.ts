import { Injectable } from '@nestjs/common';

// ─────────────────────────────────────────────
// TIPOS PÚBLICOS
// ─────────────────────────────────────────────

/** Huella estilométrica de un texto */
export type StyleProfile = {
  avgSentenceLength: number;   // promedio de palabras por oración
  avgWordLength: number;       // promedio de letras por palabra
  vocabularyRichness: number;  // palabras únicas / total de palabras (0-100)
  punctuationDensity: number;  // signos de puntuación cada 100 palabras
  connectorUsage: number;      // conectores lógicos cada 100 palabras
  passiveVoiceRatio: number;   // oraciones con indicios de voz pasiva (0-100)
  avgParagraphLength: number;  // promedio de oraciones por párrafo
};

/** Segmento que rompe el estilo del autor */
export type StyleAnomaly = {
  segmentIndex: number;
  segmentText: string;
  deviation: number;           // qué tan diferente es del perfil base (0-100)
  reason: string;              // explicación legible
};

/** Resultado del análisis estilométrico de autoría entre dos documentos */
export type AuthorshipMatch = {
  documentId: number;
  title: string;
  styleScore: number;          // similitud estilométrica (0-100)
  sameAuthorLikelihood: 'alta' | 'media' | 'baja';
};

/** Resultado completo que se agrega al AnalysisResponse */
export type StylometryResult = {
  profile: StyleProfile;                  // perfil del documento analizado
  anomalies: StyleAnomaly[];              // segmentos que rompen el estilo
  authorshipMatches: AuthorshipMatch[];   // comparación con documentos de la BD
  consistencyScore: number;              // consistencia interna (0-100)
};

// ─────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────

/** Conectores lógicos comunes en español académico */
const CONNECTORS = [
  'sin embargo', 'por lo tanto', 'en consecuencia', 'asimismo',
  'además', 'no obstante', 'por otro lado', 'en cambio',
  'debido a', 'dado que', 'puesto que', 'por ende',
  'en efecto', 'es decir', 'por consiguiente', 'así mismo',
  'de esta manera', 'en este sentido', 'cabe destacar',
];

/** Patrones de voz pasiva en español */
const PASSIVE_PATTERNS = [
  /\bfue\s+\w+do\b/gi,
  /\bfueron\s+\w+dos\b/gi,
  /\bse\s+\w+[aeiou]\b/gi,
  /\bha\s+sido\b/gi,
  /\bhan\s+sido\b/gi,
  /\bes\s+\w+do\b/gi,
  /\bson\s+\w+dos\b/gi,
];

// ─────────────────────────────────────────────
// SERVICIO
// ─────────────────────────────────────────────

@Injectable()
export class StylometryService {

  // ── MÉTODO PRINCIPAL ──────────────────────

  /**
   * Analiza la estilometría de un documento.
   * @param targetText   Texto del documento a analizar
   * @param sourceDocuments  Documentos internos de la BD para comparar autoría
   */
  analyze(
    targetText: string,
    sourceDocuments: { id: number; title: string; content: string | null }[],
  ): StylometryResult {
    // 1. Extraer perfil del documento analizado
    const profile = this.extractProfile(targetText);

    // 2. Detectar anomalías internas (segmentos que rompen el estilo)
    const anomalies = this.detectAnomalies(targetText, profile);

    // 3. Comparar con documentos internos de la BD
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

    // 4. Score de consistencia interna (100 = muy consistente, 0 = muy inconsistente)
    const consistencyScore = anomalies.length === 0
      ? 100
      : this.round(
          Math.max(0, 100 - (anomalies.reduce((acc, a) => acc + a.deviation, 0) / anomalies.length)),
        );

    return { profile, anomalies, authorshipMatches, consistencyScore };
  }

  // ── EXTRACCIÓN DE PERFIL ──────────────────

  /**
   * Extrae la huella estilométrica de un texto.
   * Calcula 7 métricas independientes.
   */
  extractProfile(text: string): StyleProfile {
    const sentences = this.splitSentences(text);
    const words = this.getWords(text);
    const paragraphs = this.splitParagraphs(text);

    // Métrica 1: promedio de palabras por oración
    const avgSentenceLength = sentences.length > 0
      ? words.length / sentences.length
      : 0;

    // Métrica 2: promedio de letras por palabra
    const avgWordLength = words.length > 0
      ? words.reduce((acc, w) => acc + w.length, 0) / words.length
      : 0;

    // Métrica 3: riqueza de vocabulario (palabras únicas / total * 100)
    const uniqueWords = new Set(words.map((w) => w.toLowerCase()));
    const vocabularyRichness = words.length > 0
      ? (uniqueWords.size / words.length) * 100
      : 0;

    // Métrica 4: densidad de puntuación (signos cada 100 palabras)
    const punctuationCount = (text.match(/[.,;:!?()"\-—]/g) || []).length;
    const punctuationDensity = words.length > 0
      ? (punctuationCount / words.length) * 100
      : 0;

    // Métrica 5: uso de conectores lógicos cada 100 palabras
    const lowerText = text.toLowerCase();
    const connectorCount = CONNECTORS.reduce(
      (acc, connector) => acc + (lowerText.split(connector).length - 1),
      0,
    );
    const connectorUsage = words.length > 0
      ? (connectorCount / words.length) * 100
      : 0;

    // Métrica 6: ratio de voz pasiva (oraciones con patrón pasivo / total)
    const passiveSentences = sentences.filter((s) =>
      PASSIVE_PATTERNS.some((pattern) => pattern.test(s)),
    ).length;
    const passiveVoiceRatio = sentences.length > 0
      ? (passiveSentences / sentences.length) * 100
      : 0;

    // Métrica 7: promedio de oraciones por párrafo
    const avgParagraphLength = paragraphs.length > 0
      ? sentences.length / paragraphs.length
      : 0;

    return {
      avgSentenceLength:   this.round(avgSentenceLength),
      avgWordLength:       this.round(avgWordLength),
      vocabularyRichness:  this.round(vocabularyRichness),
      punctuationDensity:  this.round(punctuationDensity),
      connectorUsage:      this.round(connectorUsage),
      passiveVoiceRatio:   this.round(passiveVoiceRatio),
      avgParagraphLength:  this.round(avgParagraphLength),
    };
  }

  // ── COMPARACIÓN DE PERFILES ───────────────

  /**
   * Compara dos perfiles estilométricos.
   * Devuelve similitud de 0 a 100.
   * Usa distancia euclidiana normalizada sobre las 7 métricas.
   */
  compareProfiles(profileA: StyleProfile, profileB: StyleProfile): number {
    // Pesos de cada métrica (suman 1.0)
    const weights: Record<keyof StyleProfile, number> = {
      avgSentenceLength:  0.20,
      avgWordLength:      0.15,
      vocabularyRichness: 0.20,
      punctuationDensity: 0.15,
      connectorUsage:     0.15,
      passiveVoiceRatio:  0.10,
      avgParagraphLength: 0.05,
    };

    // Rangos máximos esperados para normalizar cada métrica
    const ranges: Record<keyof StyleProfile, number> = {
      avgSentenceLength:  40,
      avgWordLength:      8,
      vocabularyRichness: 100,
      punctuationDensity: 30,
      connectorUsage:     10,
      passiveVoiceRatio:  60,
      avgParagraphLength: 20,
    };

    let weightedDistance = 0;

    (Object.keys(weights) as Array<keyof StyleProfile>).forEach((key) => {
      const range = ranges[key] || 1;
      const diff = Math.abs(profileA[key] - profileB[key]);
      const normalizedDiff = Math.min(diff / range, 1); // 0 = igual, 1 = máximo diferente
      weightedDistance += normalizedDiff * weights[key];
    });

    // Convertir distancia (0-1) a similitud (0-100)
    return Math.max(0, (1 - weightedDistance) * 100);
  }

  // ── DETECCIÓN DE ANOMALÍAS ────────────────

  /**
   * Divide el documento en ventanas y detecta segmentos
   * cuyo perfil se desvía significativamente del perfil base.
   */
  private detectAnomalies(text: string, baseProfile: StyleProfile): StyleAnomaly[] {
    const paragraphs = this.splitParagraphs(text);
    if (paragraphs.length < 3) return []; // texto muy corto, no aplica

    const anomalies: StyleAnomaly[] = [];
    const DEVIATION_THRESHOLD = 30; // desviación mínima para considerar anomalía

    // Analizar cada párrafo contra el perfil base
    paragraphs.forEach((paragraph, index) => {
      if (paragraph.trim().length < 80) return; // párrafos muy cortos se omiten

      const segmentProfile = this.extractProfile(paragraph);
      const similarity = this.compareProfiles(baseProfile, segmentProfile);
      const deviation = 100 - similarity;

      if (deviation >= DEVIATION_THRESHOLD) {
        const reason = this.buildAnomalyReason(baseProfile, segmentProfile);
        anomalies.push({
          segmentIndex: index,
          segmentText: paragraph.slice(0, 200) + (paragraph.length > 200 ? '…' : ''),
          deviation: this.round(deviation),
          reason,
        });
      }
    });

    // Ordenar por mayor desviación
    return anomalies.sort((a, b) => b.deviation - a.deviation).slice(0, 10);
  }

  /**
   * Genera una explicación legible de por qué un segmento es anómalo.
   */
  private buildAnomalyReason(base: StyleProfile, segment: StyleProfile): string {
    const reasons: string[] = [];

    if (Math.abs(segment.avgSentenceLength - base.avgSentenceLength) > 8) {
      const dir = segment.avgSentenceLength > base.avgSentenceLength ? 'más largas' : 'más cortas';
      reasons.push(`oraciones ${dir} de lo habitual`);
    }
    if (Math.abs(segment.vocabularyRichness - base.vocabularyRichness) > 15) {
      const dir = segment.vocabularyRichness > base.vocabularyRichness ? 'mayor' : 'menor';
      reasons.push(`${dir} variedad de vocabulario`);
    }
    if (Math.abs(segment.connectorUsage - base.connectorUsage) > 3) {
      const dir = segment.connectorUsage > base.connectorUsage ? 'más' : 'menos';
      reasons.push(`usa ${dir} conectores lógicos`);
    }
    if (Math.abs(segment.passiveVoiceRatio - base.passiveVoiceRatio) > 20) {
      const dir = segment.passiveVoiceRatio > base.passiveVoiceRatio ? 'más' : 'menos';
      reasons.push(`${dir} voz pasiva de lo habitual`);
    }
    if (Math.abs(segment.punctuationDensity - base.punctuationDensity) > 8) {
      const dir = segment.punctuationDensity > base.punctuationDensity ? 'mayor' : 'menor';
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

  private splitParagraphs(text: string): string[] {
    const byBlankLine = text
      .replace(/\r\n/g, '\n')
      .split(/\n\s*\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 30);

    if (byBlankLine.length >= 2) return byBlankLine;

    return text
      .split(/\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 30);
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