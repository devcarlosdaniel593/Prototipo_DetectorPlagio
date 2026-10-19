import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { parsePersistToRepository } from './persist-options.util';

/**
 * Campos de texto de POST /documents/upload. Como llegan en multipart/form-data
 * (siempre como texto), userId y persistToRepository se convierten antes de validar.
 */
export class UploadDocumentDto {
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  userId: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  title: string;

  /** Por defecto true — mantiene compatibilidad con el comportamiento anterior. */
  @IsOptional()
  @Transform(({ value }) => parsePersistToRepository(value))
  @IsBoolean()
  persistToRepository?: boolean;
}
