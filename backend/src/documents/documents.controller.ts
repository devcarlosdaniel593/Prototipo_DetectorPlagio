import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { UploadDocumentDto } from './upload-document.dto';
import type { AnalysisResponse } from '../analysis/analysis.service';
import { DocumentUploadPipeline } from './document-upload.pipeline';
import { parsePersistToRepository } from './persist-options.util';
import { fixUploadFileNames } from './file-name.util';
import type { BatchAnalysisResult } from './batch-analysis.types';

export type { BatchAnalysisResult } from './batch-analysis.types';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly uploadPipeline: DocumentUploadPipeline) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      dest: './uploads',
      limits: { fileSize: 10_000_000 },
    }),
  )
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadDocumentDto,
  ): Promise<AnalysisResponse> {
    if (!body?.title?.trim()) {
      throw new BadRequestException('El titulo es obligatorio');
    }
    fixUploadFileNames(file ? [file] : []);

    return this.uploadPipeline.uploadAnalyzeAndMaybePersist(
      file,
      body.userId,
      body.title.trim(),
      parsePersistToRepository(body.persistToRepository ?? true),
    );
  }

  @Post('upload-batch')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      dest: './uploads',
      limits: { fileSize: 10_000_000 },
    }),
  )
  async uploadBatch(
    @UploadedFiles() files: Express.Multer.File[],
    @Body()
    body: {
      userId: string;
      titles: string;
      persistToRepository?: string;
    },
  ): Promise<BatchAnalysisResult[]> {
    if (!files || files.length === 0) {
      throw new BadRequestException('Debes enviar al menos un archivo PDF');
    }
    fixUploadFileNames(files);

    let titles: string[] = [];
    try {
      titles = JSON.parse(body.titles || '[]');
    } catch {
      throw new BadRequestException(
        'El campo titles debe ser un JSON array de strings',
      );
    }

    if (titles.length !== files.length) {
      throw new BadRequestException(
        `Se recibieron ${files.length} archivo(s) pero ${titles.length} título(s). Deben coincidir.`,
      );
    }

    const userId = Number(body.userId);
    if (!userId || isNaN(userId)) {
      throw new BadRequestException('userId inválido');
    }

    const normalizedTitles = titles.map((t, i) => {
      const trimmed = (t || '').trim();
      if (!trimmed) {
        throw new BadRequestException(
          `El título del archivo ${i + 1} es obligatorio`,
        );
      }
      return trimmed;
    });

    return this.uploadPipeline.uploadBatchAnalyzeAndMaybePersist(
      files,
      userId,
      normalizedTitles,
      parsePersistToRepository(body.persistToRepository),
    );
  }
}
