import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StylometryService } from '../analysis/stylometry.service';
import {
  DocumentAnalysisService,
  type ReferenceLabel,
} from './document-analysis.service';

// ─────────────────────────────────────────────
// TIPOS PÚBLICOS
// ─────────────────────────────────────────────

export type DocumentMetric = {
  documentId: number;
  title: string;
  processingTimeMs: number;
  overallSimilarity: number;
  consistencyScore: number;
  anomaliesDetected: number;
  sourcesFound: number;
  semanticServiceStatus: 'ok' | 'degraded';
  detectedAsSimilar: boolean;
  riskLevel: 'alto' | 'medio' | 'bajo';
  systemClassification: 'similar' | 'no_similar';
  referenceLabel: ReferenceLabel | null;
  analyzedAt: string;
};

/**
 * Métricas de clasificación calculadas SOLO sobre documentos con etiqueta
 * de referencia. Si no hay documentos etiquetados, precision/recall/f1/accuracy
 * son null (no se inventan valores).
 */
export type PrecisionRecallMetrics = {
  similarityThreshold: number;
  totalDocuments: number;
  detectedAsSimilar: number;
  labeledDocuments: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  precision: number | null;
  recall: number | null;
  f1Score: number | null;
  accuracy: number | null;
};

export type StylometryMetrics = {
  totalAnalyzed: number;
  withAnomalies: number;
  anomalyDetectionRate: number;
  avgConsistencyScore: number;
  highAuthorshipMatches: number;
};

export type PerformanceMetrics = {
  avgProcessingTimeMs: number;
  minProcessingTimeMs: number;
  maxProcessingTimeMs: number;
  totalDocumentsProcessed: number;
  degradedServiceCount: number;
};

export type EvaluationReport = {
  generatedAt: string;
  totalDocumentsInDB: number;
  documentsWithMetrics: number;
  documentsPendingMetrics: number;
  lastAnalysisAt: string | null;
  dataSource: 'stored';
  precisionRecall: PrecisionRecallMetrics;
  stylometry: StylometryMetrics;
  performance: PerformanceMetrics;
  perDocument: DocumentMetric[];
  summary: string;
};

// ─────────────────────────────────────────────
// SERVICIO
// ─────────────────────────────────────────────

@Injectable()
export class EvaluationService {
  private readonly logger = new Logger(EvaluationService.name);

  private readonly SIMILARITY_THRESHOLD = 40;
  private readonly AUTHORSHIP_THRESHOLD = 70;

  constructor(
    private readonly prisma: PrismaService,
    private readonly stylometryService: StylometryService,
    private readonly documentAnalysisService: DocumentAnalysisService,
  ) {}

  /**
   * Arma el reporte leyendo métricas ya guardadas.
   * Las métricas se actualizan cada vez que se sube/analiza un PDF.
   */
  async generateReport(): Promise<EvaluationReport> {
    this.logger.log('Generando reporte desde métricas almacenadas…');

    const [totalDocumentsInDB, snapshots] = await Promise.all([
      this.prisma.document.count(),
      this.documentAnalysisService.findAllWithDocuments(),
    ]);

    const documentsWithMetrics = snapshots.length;
    const documentsPendingMetrics = Math.max(
      0,
      totalDocumentsInDB - documentsWithMetrics,
    );

    if (documentsWithMetrics === 0) {
      return this.emptyReport(totalDocumentsInDB, documentsPendingMetrics);
    }

    const lastAnalysisAt = snapshots
      .reduce(
        (latest, row) => (row.analyzedAt > latest ? row.analyzedAt : latest),
        snapshots[0].analyzedAt,
      )
      .toISOString();

    const perDocument: DocumentMetric[] = snapshots.map((row) => ({
      documentId: row.documentId,
      title: row.document.title,
      processingTimeMs: row.processingTimeMs,
      overallSimilarity: row.overallSimilarity,
      consistencyScore: row.consistencyScore,
      anomaliesDetected: row.anomaliesDetected,
      sourcesFound: row.sourcesFound,
      semanticServiceStatus: row.semanticServiceStatus as 'ok' | 'degraded',
      detectedAsSimilar: row.detectedAsSimilar,
      riskLevel: row.riskLevel as DocumentMetric['riskLevel'],
      systemClassification:
        row.systemClassification as DocumentMetric['systemClassification'],
      referenceLabel: this.normalizeLabel(row.referenceLabel),
      analyzedAt: row.analyzedAt.toISOString(),
    }));

    const precisionRecall = this.calculatePrecisionRecall(perDocument);
    const stylometry = this.calculateStylometryMetrics(
      perDocument,
      snapshots.map((row) => row.document.content),
    );
    const performance = this.calculatePerformanceMetrics(perDocument);
    const summary = this.buildSummary(
      precisionRecall,
      stylometry,
      performance,
      documentsPendingMetrics,
    );

    this.logger.log(
      `Reporte listo — ${documentsWithMetrics} documento(s), ${precisionRecall.labeledDocuments} etiquetado(s).`,
    );

    return {
      generatedAt: new Date().toISOString(),
      totalDocumentsInDB,
      documentsWithMetrics,
      documentsPendingMetrics,
      lastAnalysisAt,
      dataSource: 'stored',
      precisionRecall,
      stylometry,
      performance,
      perDocument,
      summary,
    };
  }

  /**
   * Matriz de confusión sobre los documentos etiquetados:
   *   positivo real      = etiqueta "similar"
   *   positivo predicho  = el sistema lo clasificó como similar (≥ umbral)
   */
  private calculatePrecisionRecall(
    metrics: DocumentMetric[],
  ): PrecisionRecallMetrics {
    const labeled = metrics.filter((m) => m.referenceLabel !== null);

    let tp = 0;
    let fp = 0;
    let tn = 0;
    let fn = 0;
    for (const m of labeled) {
      const actualPositive = m.referenceLabel === 'similar';
      const predictedPositive = m.detectedAsSimilar;
      if (predictedPositive && actualPositive) tp++;
      else if (predictedPositive && !actualPositive) fp++;
      else if (!predictedPositive && actualPositive) fn++;
      else tn++;
    }

    const precision = tp + fp > 0 ? (tp / (tp + fp)) * 100 : null;
    const recall = tp + fn > 0 ? (tp / (tp + fn)) * 100 : null;
    const f1Score =
      precision !== null && recall !== null && precision + recall > 0
        ? (2 * precision * recall) / (precision + recall)
        : null;
    const accuracy =
      labeled.length > 0 ? ((tp + tn) / labeled.length) * 100 : null;

    return {
      similarityThreshold: this.SIMILARITY_THRESHOLD,
      totalDocuments: metrics.length,
      detectedAsSimilar: metrics.filter((m) => m.detectedAsSimilar).length,
      labeledDocuments: labeled.length,
      truePositives: tp,
      falsePositives: fp,
      trueNegatives: tn,
      falseNegatives: fn,
      precision: this.roundOrNull(precision),
      recall: this.roundOrNull(recall),
      f1Score: this.roundOrNull(f1Score),
      accuracy: this.roundOrNull(accuracy),
    };
  }

  /**
   * Métricas estilométricas del corpus.
   * Optimización: el perfil de cada documento se calcula UNA sola vez
   * (antes se recalculaba dentro del doble bucle).
   */
  private calculateStylometryMetrics(
    metrics: DocumentMetric[],
    contents: (string | null)[],
  ): StylometryMetrics {
    const totalAnalyzed = metrics.length;
    const withAnomalies = metrics.filter((m) => m.anomaliesDetected > 0).length;
    const anomalyDetectionRate =
      totalAnalyzed > 0 ? (withAnomalies / totalAnalyzed) * 100 : 0;
    const avgConsistencyScore =
      totalAnalyzed > 0
        ? metrics.reduce((acc, m) => acc + m.consistencyScore, 0) / totalAnalyzed
        : 0;

    const profiles = contents
      .filter((c): c is string => !!c && c.trim().length > 100)
      .map((c) => this.stylometryService.extractProfile(c));

    let highAuthorshipMatches = 0;
    for (let i = 0; i < profiles.length; i++) {
      for (let j = i + 1; j < profiles.length; j++) {
        const score = this.stylometryService.compareProfiles(
          profiles[i],
          profiles[j],
        );
        if (score >= this.AUTHORSHIP_THRESHOLD) highAuthorshipMatches++;
      }
    }

    return {
      totalAnalyzed,
      withAnomalies,
      anomalyDetectionRate: this.round(anomalyDetectionRate),
      avgConsistencyScore: this.round(avgConsistencyScore),
      highAuthorshipMatches,
    };
  }

  private calculatePerformanceMetrics(
    metrics: DocumentMetric[],
  ): PerformanceMetrics {
    if (metrics.length === 0) {
      return {
        avgProcessingTimeMs: 0,
        minProcessingTimeMs: 0,
        maxProcessingTimeMs: 0,
        totalDocumentsProcessed: 0,
        degradedServiceCount: 0,
      };
    }

    const times = metrics.map((m) => m.processingTimeMs);
    return {
      avgProcessingTimeMs: this.round(
        times.reduce((a, b) => a + b, 0) / times.length,
      ),
      minProcessingTimeMs: Math.min(...times),
      maxProcessingTimeMs: Math.max(...times),
      totalDocumentsProcessed: metrics.length,
      degradedServiceCount: metrics.filter(
        (m) => m.semanticServiceStatus === 'degraded',
      ).length,
    };
  }

  private buildSummary(
    pr: PrecisionRecallMetrics,
    sty: StylometryMetrics,
    perf: PerformanceMetrics,
    pendingMetrics: number,
  ): string {
    const pendingNote =
      pendingMetrics > 0
        ? ` Hay ${pendingMetrics} documento(s) en la BD sin métricas guardadas.`
        : '';

    const classification =
      pr.labeledDocuments > 0
        ? `Sobre ${pr.labeledDocuments} documento(s) etiquetado(s): precisión ${this.fmt(pr.precision)}, ` +
          `recall ${this.fmt(pr.recall)}, F1 ${this.fmt(pr.f1Score)}, exactitud ${this.fmt(pr.accuracy)} ` +
          `(VP ${pr.truePositives}, FP ${pr.falsePositives}, VN ${pr.trueNegatives}, FN ${pr.falseNegatives}; umbral ${pr.similarityThreshold}%).`
        : 'Precisión, recall y F1 no se calculan porque no hay documentos con etiqueta de referencia.';

    return (
      `Reporte basado en ${perf.totalDocumentsProcessed} análisis guardado(s). ` +
      `${classification} ` +
      `Tiempo promedio de análisis: ${perf.avgProcessingTimeMs} ms. ` +
      `Estilometría: ${sty.withAnomalies}/${sty.totalAnalyzed} con anomalías (${sty.anomalyDetectionRate}%).` +
      pendingNote
    );
  }

  private emptyReport(
    totalDocumentsInDB: number,
    documentsPendingMetrics: number,
  ): EvaluationReport {
    const summary =
      totalDocumentsInDB === 0
        ? 'No hay documentos en la base de datos. Sube PDFs desde el analizador para poblar el dashboard.'
        : `Hay ${totalDocumentsInDB} documento(s) en la BD pero ninguno con métricas guardadas. ` +
          'Sube o re-analiza documentos desde el analizador; las métricas se guardarán automáticamente.';

    return {
      generatedAt: new Date().toISOString(),
      totalDocumentsInDB,
      documentsWithMetrics: 0,
      documentsPendingMetrics,
      lastAnalysisAt: null,
      dataSource: 'stored',
      precisionRecall: {
        similarityThreshold: this.SIMILARITY_THRESHOLD,
        totalDocuments: 0,
        detectedAsSimilar: 0,
        labeledDocuments: 0,
        truePositives: 0,
        falsePositives: 0,
        trueNegatives: 0,
        falseNegatives: 0,
        precision: null,
        recall: null,
        f1Score: null,
        accuracy: null,
      },
      stylometry: {
        totalAnalyzed: 0,
        withAnomalies: 0,
        anomalyDetectionRate: 0,
        avgConsistencyScore: 0,
        highAuthorshipMatches: 0,
      },
      performance: {
        avgProcessingTimeMs: 0,
        minProcessingTimeMs: 0,
        maxProcessingTimeMs: 0,
        totalDocumentsProcessed: 0,
        degradedServiceCount: 0,
      },
      perDocument: [],
      summary,
    };
  }

  private normalizeLabel(value: string | null): ReferenceLabel | null {
    return value === 'similar' || value === 'original' ? value : null;
  }

  private fmt(value: number | null): string {
    return value === null ? '—' : `${value}%`;
  }

  private roundOrNull(value: number | null): number | null {
    return value === null ? null : this.round(value);
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
