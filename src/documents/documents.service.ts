import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { extractTextFromPDF } from './pdf.service';
import { calculateSimilarity } from '../analysis/similarity.service';

@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async saveDocument(file: Express.Multer.File, userId: number, title: string) {
    try {
      console.log('1. Iniciando proceso...');

      // 1️⃣ Extraer texto
      console.log('2. Extrayendo texto...');
      const text: string = await extractTextFromPDF(file.path);

      if (!text || text.trim().length === 0) {
        console.log('❌ Texto vacío');
        throw new Error('No se pudo extraer texto del PDF');
      }

      console.log('3. Texto extraído correctamente');

      // 2️⃣ Validar usuario
      console.log('4. Validando usuario...');
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        console.log('❌ Usuario no existe');
        throw new Error('El usuario no existe');
      }

      console.log('5. Usuario válido');

      // 3️⃣ Obtener documentos existentes
      console.log('6. Consultando documentos...');
      const existingDocs = await this.prisma.document.findMany();

      console.log('7. Documentos encontrados:', existingDocs.length);

      // 4️⃣ Comparar similitud
      console.log('8. Iniciando comparación...');
      const comparisons = existingDocs
        .map((doc) => {
          if (typeof doc.content !== 'string') return null;

          const similarity = calculateSimilarity(text, doc.content);

          return {
            documentId: doc.id,
            title: doc.title,
            similarity,
          };
        })
        .filter(
          (
            doc,
          ): doc is {
            documentId: number;
            title: string;
            similarity: number;
          } => doc !== null && doc.similarity > 20,
        )
        .sort((a, b) => b.similarity - a.similarity);

      console.log('9. Comparación terminada');

      // 5️⃣ Guardar documento
      console.log('10. Guardando documento...');
      const document = await this.prisma.document.create({
        data: {
          title,
          filePath: file.path,
          userId,
          content: text,
        },
      });

      console.log('11. Documento guardado');

      // 6️⃣ Respuesta final
      console.log('12. Proceso finalizado');

      return {
        message: 'Documento subido y analizado',
        document,
        comparisons,
      };
    } catch (error) {
      console.error('🔥 ERROR EN saveDocument:', error);
      throw error;
    }
  }
}
