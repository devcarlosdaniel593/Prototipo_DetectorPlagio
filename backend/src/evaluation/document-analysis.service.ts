import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AnalysisResponse } from '../analysis/analysis.service';

/**
 * Umbral (en %) a partir del cual un documento se clasifica como 'similar'.
 * Debe coincidir con EvaluationService.SIMILARITY_THRESHOLD, que lo muestra en el reporte.
 */
const SIMILARITY_THRESHOLD = 40;

/** Valores válidos para la etiqueta de referencia de un documento. */
export type ReferenceLabel = 'similar' | 'original';

/**
 * Lectura y escritura de la tabla DocumentAnalysis (una fila por documento
 * analizado en modo repositorio).
 */
@Injectable()
export class DocumentAnalysisService {
  private readonly logger = new Logger(DocumentAnalysisService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Guarda o actualiza las métricas de evaluación tras analizar un documento.
   * Se invoca automáticamente al subir PDFs desde el analizador.
   * La etiqueta de referencia (referenceLabel) no se toca: si el documento
   * se vuelve a analizar, conserva la etiqueta que le asignó el evaluador.
   */
  async saveFromAnalysisResult(
    documentId: number,
    result: AnalysisResponse,
    processingTimeMs: number,
  ): Promise<void> {
    const overallSimilarity = result.overallSimilarity;
    const sourcesFound = result.summary.length;
    const detectedAsSimilar =
      overallSimilarity >= SIMILARITY_THRESHOLD && sourcesFound > 0;

    let riskLevel = 'bajo';
    if (overallSimilarity >= 80) riskLevel = 'alto';
    else if (overallSimilarity >= 50) riskLevel = 'medio';

    // Reglas de clasificación aplicadas sobre overallSimilarity:
    //   detectedAsSimilar = similitud ≥ 40 % y al menos una fuente con evidencia
    //   riskLevel         = 'alto' (≥ 80), 'medio' (≥ 50) o 'bajo'
    // Son umbrales fijos del prototipo para orientar la revisión del docente.
    const metrics = {
      overallSimilarity,
      consistencyScore: result.stylometry.consistencyScore,
      anomaliesDetected: result.stylometry.anomalies.length,
      sourcesFound,
      processingTimeMs,
      semanticServiceStatus: result.semanticServiceStatus,
      detectedAsSimilar,
      riskLevel,
      systemClassification: detectedAsSimilar ? 'similar' : 'no_similar',
    };

    // upsert: crea la fila la primera vez y la actualiza en los reanálisis
    // (documentId es único en DocumentAnalysis).
    await this.prisma.documentAnalysis.upsert({
      where: { documentId },
      create: { documentId, ...metrics },
      update: { ...metrics, analyzedAt: new Date() },
    });

    this.logger.log(
      `Métricas guardadas para documento ${documentId} — similitud ${overallSimilarity}%`,
    );
  }

  /**
   * Asigna (o quita, con null) la etiqueta de referencia de un documento.
   * Es la "verdad conocida" contra la que se calculan precisión, recall y F1.
   */
  async setReferenceLabel(documentId: number, label: ReferenceLabel | null) {
    const existing = await this.prisma.documentAnalysis.findUnique({
      where: { documentId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(
        `El documento ${documentId} no tiene métricas guardadas. Analízalo primero.`,
      );
    }

    const updated = await this.prisma.documentAnalysis.update({
      where: { documentId },
      data: { referenceLabel: label },
      select: { documentId: true, referenceLabel: true },
    });

    this.logger.log(
      `Etiqueta de referencia del documento ${documentId}: ${label ?? 'sin etiqueta'}`,
    );
    return updated;
  }

  /**
   * Todas las métricas guardadas con el id, título y contenido de su
   * documento, de la más reciente a la más antigua. Lo usa EvaluationService.
   */
  async findAllWithDocuments() {
    return this.prisma.documentAnalysis.findMany({
      include: {
        document: {
          select: { id: true, title: true, content: true },
        },
      },
      orderBy: { analyzedAt: 'desc' },
    });
  }
}
