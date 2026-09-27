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
