import { IsIn, IsOptional } from 'class-validator';
import type { ReferenceLabel } from './document-analysis.service';

/**
 * Cuerpo de PATCH /evaluation/documents/:documentId/label
 *   { "label": "similar" }   → el documento contiene contenido reutilizado
 *   { "label": "original" }  → el documento es original
 *   { "label": null }        → quitar la etiqueta
 */
export class SetReferenceLabelDto {
  @IsOptional()
  @IsIn(['similar', 'original'])
  label?: ReferenceLabel | null;
}
