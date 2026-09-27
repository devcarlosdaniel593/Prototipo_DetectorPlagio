import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AnalysisResponse } from '../analysis/analysis.service';

const SIMILARITY_THRESHOLD = 40;

@Injectable()
export class DocumentAnalysisService {
  private readonly logger = new Logger(DocumentAnalysisService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Guarda o actualiza las métricas de evaluación tras analizar un documento.
   * Se invoca automáticamente al subir PDFs desde el analizador.
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

    await this.prisma.documentAnalysis.upsert({
      where: { documentId },
      create: {
        documentId,
        overallSimilarity,
        consistencyScore: result.stylometry.consistencyScore,
        anomaliesDetected: result.stylometry.anomalies.length,
        sourcesFound,
        processingTimeMs,
        semanticServiceStatus: result.semanticServiceStatus,
        detectedAsSimilar,
        riskLevel,
        systemClassification: detectedAsSimilar ? 'similar' : 'no_similar',
      },
      update: {
        overallSimilarity,
        consistencyScore: result.stylometry.consistencyScore,
        anomaliesDetected: result.stylometry.anomalies.length,
        sourcesFound,
        processingTimeMs,
        semanticServiceStatus: result.semanticServiceStatus,
        detectedAsSimilar,
        riskLevel,
        systemClassification: detectedAsSimilar ? 'similar' : 'no_similar',
        analyzedAt: new Date(),
      },
    });

    this.logger.log(
      `Métricas guardadas para documento ${documentId} — similitud ${overallSimilarity}%`,
    );
  }

  async countSnapshots(): Promise<number> {
    return this.prisma.documentAnalysis.count();
  }

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
