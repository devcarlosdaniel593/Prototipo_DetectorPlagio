import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { cleanText } from '../text.utils';
import type { ExternalSourceDocument } from './web-provider.types';

/**
 * Hash entero de 32 bits (estilo Java String.hashCode). Se usa para derivar
 * ids numéricos de las fuentes web; no es un hash criptográfico y dos
 * cadenas distintas pueden producir el mismo valor.
 */
export function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

/** Correo de contacto (CONTACT_EMAIL) que algunas APIs académicas solicitan para identificar al cliente. */
export function contactEmail(): string {
  return process.env.CONTACT_EMAIL || 'prototipo-tesis@localhost';
}

/** Cabeceras HTTP comunes: User-Agent con el correo de contacto y Accept JSON. */
export function defaultHeaders(): Record<string, string> {
  return {
    'User-Agent': `PrototipoTesis/1.0 (mailto:${contactEmail()})`,
    Accept: 'application/json',
  };
}

/** Deduplica por URL; si no hay URL, por los primeros 180 caracteres del contenido normalizado. */
export function deduplicateByUrlOrContent(
  docs: ExternalSourceDocument[],
): ExternalSourceDocument[] {
  const unique = new Map<string, ExternalSourceDocument>();
  docs.forEach((doc) => {
    const key = doc.url
      ? `url:${doc.url}`
      : `content:${cleanText(doc.content).slice(0, 180)}`;
    if (!unique.has(key)) unique.set(key, doc);
  });
  return Array.from(unique.values());
}

/**
 * OpenAlex entrega el resumen como índice invertido ({ palabra: [posiciones] }).
 * Esta función lo reconstruye ordenando las palabras por posición.
 */
export function rebuildOpenAlexAbstract(
  invertedIndex?: Record<string, number[]>,
): string {
  if (!invertedIndex) return '';
  const positionToWord: Array<{ pos: number; word: string }> = [];
  Object.entries(invertedIndex).forEach(([word, positions]) => {
    positions.forEach((pos) => positionToWord.push({ pos, word }));
  });
  positionToWord.sort((a, b) => a.pos - b.pos);
  return positionToWord.map((entry) => entry.word).join(' ');
}

/**
 * GET con un reintento cuando el proveedor responde 429 (demasiadas peticiones).
 * Espera lo que indique la cabecera Retry-After (máximo 3 s) o 1,5 s por defecto.
 * Cualquier otro error se propaga igual que antes.
 */
export async function getWithRetry(
  url: string,
  config: AxiosRequestConfig = {},
): Promise<AxiosResponse> {
  try {
    return await axios.get(url, config);
  } catch (error) {
    if (!axios.isAxiosError(error) || error.response?.status !== 429) {
      throw error;
    }
    const retryAfterSeconds = Number(error.response.headers?.['retry-after']);
    const waitMs = Number.isFinite(retryAfterSeconds)
      ? Math.min(retryAfterSeconds * 1000, 3000)
      : 1500;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return axios.get(url, config);
  }
}
