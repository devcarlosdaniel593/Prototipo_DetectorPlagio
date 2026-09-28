import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { type Document as PrismaDocument } from '@prisma/client';
import { createHash } from 'crypto';
import { unlink } from 'fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import { extractTextFromPDF } from './pdf.service';

/**
 * Huella del texto extraído. Se normalizan los espacios para que el mismo PDF
 * produzca siempre la misma huella aunque cambie la forma de unir el texto.
 * IMPORTANTE: scripts/backfill-content-hash.js usa exactamente esta misma fórmula.
 */
export function computeContentHash(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export type SaveDocumentResult = {
  document: PrismaDocument;
  /** true si el PDF ya existía en el repositorio y se reutilizó el registro. */
  reused: boolean;
};

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Extrae el texto del PDF y lo registra en la base de datos.
   *
   * - El PDF temporal que deja multer en ./uploads se borra siempre al terminar:
   *   el texto ya queda guardado en la columna `content`, que es lo único que usa el análisis.
   * - Si `reuseExisting` es true y ya hay un documento con el mismo contenido,
   *   se devuelve ese registro en lugar de crear un duplicado.
   *   Solo debe usarse en modo repositorio: en modo sesión el documento se borra
   *   al final y no se puede reutilizar uno del repositorio.
   */
  async saveDocument(
    file: Express.Multer.File,
    userId: number,
    title: string,
    reuseExisting: boolean,
  ): Promise<SaveDocumentResult> {
    if (!file) {
      throw new BadRequestException('Debes enviar un archivo PDF');
    }

    try {
      const text: string = await extractTextFromPDF(file.path);
      if (!text || text.trim().length === 0) {
        throw new BadRequestException('No se pudo extraer texto del PDF');
      }

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });
      if (!user) {
        throw new NotFoundException('El usuario no existe');
      }

      const contentHash = computeContentHash(text);

      if (reuseExisting) {
        const existing = await this.prisma.document.findFirst({
          where: { contentHash },
          orderBy: { id: 'asc' },
        });
        if (existing) {
          this.logger.log(
            `"${file.originalname}" ya existe como documento ${existing.id} ("${existing.title}"); se reutiliza.`,
          );
          return { document: existing, reused: true };
        }
      }

      const document = await this.prisma.document.create({
        data: {
          title,
          // Ya no se guarda la ruta del servidor: el PDF se elimina tras extraer el texto.
          filePath: file.originalname,
          content: text,
          contentHash,
          userId,
        },
      });
      return { document, reused: false };
    } finally {
      await this.removeTempFile(file.path);
    }
  }

  /**
   * Elimina un documento creado solo para análisis en sesión (sin repositorio).
   * El PDF temporal ya se borró en saveDocument.
   */
  async discardEphemeralDocument(documentId: number): Promise<void> {
    await this.prisma.document.delete({ where: { id: documentId } });
  }

  private async removeTempFile(path: string | undefined): Promise<void> {
    if (!path) return;
    try {
      await unlink(path);
    } catch {
      // El archivo pudo haber sido eliminado previamente.
    }
  }
}
