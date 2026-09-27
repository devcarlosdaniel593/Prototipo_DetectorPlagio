import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StylometryService } from '../analysis/stylometry.service';
import { DocumentAnalysisService } from './document-analysis.service';

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
  analyzedAt: string;
};

export type PrecisionRecallMetrics = {
  similarityThreshold: number;
  detectedAsSimilar: number;
  totalDocuments: number;
  highSimilarityPairs: number;
  precision: number;
  recall: number;
  f1Score: number;
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

export type EvaluationProgress = {
  status: 'idle' | 'running' | 'completed' | 'error';
  startedAt: string | null;
  finishedAt: string | null;
  totalDocuments: number;
  processedDocuments: number;
  currentDocumentId: number | null;
  currentDocumentTitle: string | null;
  lastCompletedTitle: string | null;
  elapsedMs: number;
  message: string;
  error: string | null;
  recentLogs: string[];
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

  getProgress(): EvaluationProgress {
    return {
      status: 'idle',
      startedAt: null,
      finishedAt: null,
      totalDocuments: 0,
      processedDocuments: 0,
      currentDocumentId: null,
      currentDocumentTitle: null,
      lastCompletedTitle: null,
      elapsedMs: 0,
      message:
        'El reporte usa métricas guardadas al subir documentos. No hay proceso en curso.',
      error: null,
      recentLogs: [],
    };
  }

  /**
   * Arma el reporte leyendo métricas ya guardadas (instantáneo).
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

    const lastAnalysisAt =
      snapshots.length > 0
        ? snapshots.reduce((latest, row) =>
            row.analyzedAt > latest ? row.analyzedAt : latest,
          snapshots[0].analyzedAt).toISOString()
        : null;

    if (documentsWithMetrics === 0) {
      return this.emptyReport(totalDocumentsInDB, documentsPendingMetrics);
    }

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
      systemClassification: row.systemClassification as DocumentMetric['systemClassification'],
      analyzedAt: row.analyzedAt.toISOString(),
    }));

    const documentsForStylometry = snapshots.map((row) => ({
      id: row.document.id,
      title: row.document.title,
      content: row.document.content,
    }));

    const precisionRecall = this.calculatePrecisionRecall(perDocument);
    const stylometry = this.calculateStylometryMetrics(
      perDocument,
      documentsForStylometry,
    );
    const performance = this.calculatePerformanceMetrics(perDocument);
    const summary = this.buildSummary(
      precisionRecall,
      stylometry,
      performance,
      documentsPendingMetrics,
    );

    this.logger.log(
      `Reporte listo — ${documentsWithMetrics} documento(s) con métricas guardadas.`,
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

  private calculatePrecisionRecall(
    metrics: DocumentMetric[],
  ): PrecisionRecallMetrics {
    const totalDocuments = metrics.length;
    const detectedAsSimilar = metrics.filter((m) => m.detectedAsSimilar).length;
    const highSimilarityPairs = detectedAsSimilar;

    const precision =
      detectedAsSimilar > 0 ? (highSimilarityPairs / detectedAsSimilar) * 100 : 0;
    const recall =
      totalDocuments > 0 ? (highSimilarityPairs / totalDocuments) * 100 : 0;
    const f1Score =
      precision + recall > 0
        ? (2 * precision * recall) / (precision + recall)
        : 0;

    return {
      similarityThreshold: this.SIMILARITY_THRESHOLD,
      detectedAsSimilar,
      totalDocuments,
      highSimilarityPairs,
      precision: this.round(precision),
      recall: this.round(recall),
      f1Score: this.round(f1Score),
    };
  }

  private calculateStylometryMetrics(
    metrics: DocumentMetric[],
    documents: { id: number; title: string; content: string | null }[],
  ): StylometryMetrics {
    const totalAnalyzed = metrics.length;
    const withAnomalies = metrics.filter((m) => m.anomaliesDetected > 0).length;
    const anomalyDetectionRate =
      totalAnalyzed > 0 ? (withAnomalies / totalAnalyzed) * 100 : 0;
    const avgConsistencyScore =
      totalAnalyzed > 0
        ? metrics.reduce((acc, m) => acc + m.consistencyScore, 0) / totalAnalyzed
        : 0;

    let highAuthorshipMatches = 0;
    const validDocs = documents.filter(
      (d) => d.content && d.content.trim().length > 100,
    );

    for (let i = 0; i < validDocs.length; i++) {
      for (let j = i + 1; j < validDocs.length; j++) {
        const profileA = this.stylometryService.extractProfile(
          validDocs[i].content!,
        );
        const profileB = this.stylometryService.extractProfile(
          validDocs[j].content!,
        );
        const score = this.stylometryService.compareProfiles(profileA, profileB);
        if (score >= this.AUTHORSHIP_THRESHOLD) {
          highAuthorshipMatches++;
        }
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
        ? ` Hay ${pendingMetrics} documento(s) en la BD sin métricas guardadas; analízalos subiéndolos desde el analizador.`
        : '';

    return (
      `Reporte basado en ${perf.totalDocumentsProcessed} análisis guardado(s). ` +
      `Precisión ${pr.precision}%, recall ${pr.recall}%, F1 ${pr.f1Score}% ` +
      `(umbral ${pr.similarityThreshold}%). ` +
      `Tiempo promedio de análisis al subir: ${perf.avgProcessingTimeMs}ms. ` +
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
        detectedAsSimilar: 0,
        totalDocuments: 0,
        highSimilarityPairs: 0,
        precision: 0,
        recall: 0,
        f1Score: 0,
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

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
