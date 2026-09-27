import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { type Document as PrismaDocument } from '@prisma/client';
import {
  AnalysisService,
  type AnalysisResponse,
} from '../analysis/analysis.service';
import { DocumentAnalysisService } from '../evaluation/document-analysis.service';
import { DocumentsService } from './documents.service';
import { SessionBatchRegistryService } from './session-batch.registry';
import type { BatchAnalysisResult } from './batch-analysis.types';

/**
 * Orquesta subida → análisis → persistencia opcional.
 */
@Injectable()
export class DocumentUploadPipeline {
  private readonly logger = new Logger(DocumentUploadPipeline.name);

  constructor(
    private readonly documentsService: DocumentsService,
    private readonly analysisService: AnalysisService,
    private readonly documentAnalysisService: DocumentAnalysisService,
    private readonly sessionBatchRegistry: SessionBatchRegistryService,
  ) {}

  async uploadAnalyzeAndMaybePersist(
    file: Express.Multer.File,
    userId: number,
    title: string,
    persistToRepository: boolean,
  ): Promise<AnalysisResponse> {
    const savedDocument = await this.documentsService.saveDocument(
      file,
      userId,
      title,
    );

    try {
      const startedAt = Date.now();
      const analysis = await this.analysisService.analyzeDocument(
        savedDocument.id,
      );

      if (persistToRepository) {
        await this.documentAnalysisService.saveFromAnalysisResult(
          savedDocument.id,
          analysis,
          Date.now() - startedAt,
        );
        return analysis;
      }

      this.logger.log(
        `Modo sesión: descartando documento ${savedDocument.id} sin persistir en repositorio.`,
      );
      await this.documentsService.discardEphemeralDocument(
        savedDocument.id,
        savedDocument.filePath,
      );
      return analysis;
    } catch (error) {
      if (!persistToRepository) {
        await this.documentsService
          .discardEphemeralDocument(savedDocument.id, savedDocument.filePath)
          .catch(() => undefined);
      }
      throw error;
    }
  }

  /**
   * Procesa un lote completo en 3 fases:
   * 1) Guardar todos (permite comparación entre pares del mismo envío)
   * 2) Analizar todos
   * 3) Persistir métricas o descartar documentos temporales
   */
  async uploadBatchAnalyzeAndMaybePersist(
    files: Express.Multer.File[],
    userId: number,
    titles: string[],
    persistToRepository: boolean,
  ): Promise<BatchAnalysisResult[]> {
    const batchId = persistToRepository ? null : randomUUID();
    if (batchId) {
      this.sessionBatchRegistry.createBatch(batchId);
      this.logger.log(`Lote temporal en memoria: ${batchId}`);
    }

    type SavedEntry = {
      index: number;
      file: Express.Multer.File;
      title: string;
      document?: PrismaDocument;
      saveError?: string;
    };

    const savedEntries: SavedEntry[] = [];

    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const title = titles[index];
        try {
          const document = await this.documentsService.saveDocument(
            file,
            userId,
            title,
          );
          if (batchId) {
            this.sessionBatchRegistry.register(batchId, {
              id: document.id,
              title: document.title,
              content: document.content || '',
              filePath: document.filePath,
            });
          }
          savedEntries.push({ index, file, title, document });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          savedEntries.push({ index, file, title, saveError: msg });
        }
      }

      const analysisResults = await Promise.all(
        savedEntries.map(async (entry) => {
          if (entry.saveError || !entry.document) {
            return {
              index: entry.index,
              fileName: entry.file.originalname,
              title: entry.title,
              status: 'error' as const,
              error: entry.saveError || 'No se pudo guardar el documento',
            };
          }

          try {
            const startedAt = Date.now();
            const analysis = await this.analysisService.analyzeDocument(
              entry.document.id,
            );

            if (persistToRepository) {
              await this.documentAnalysisService.saveFromAnalysisResult(
                entry.document.id,
                analysis,
                Date.now() - startedAt,
              );
            }

            return {
              index: entry.index,
              fileName: entry.file.originalname,
              title: entry.title,
              status: 'ok' as const,
              result: analysis,
              document: entry.document,
            };
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return {
              index: entry.index,
              fileName: entry.file.originalname,
              title: entry.title,
              status: 'error' as const,
              error: msg,
              document: entry.document,
            };
          }
        }),
      );

      if (!persistToRepository) {
        for (const row of analysisResults) {
          if ('document' in row && row.document) {
            await this.documentsService
              .discardEphemeralDocument(row.document.id, row.document.filePath)
              .catch(() => undefined);
          }
        }
      }

      return analysisResults.map(({ document: _doc, ...rest }) => rest);
    } finally {
      if (batchId) {
        this.sessionBatchRegistry.clear(batchId);
        this.logger.log(`Lote temporal ${batchId} liberado de memoria.`);
      }
    }
  }
}
