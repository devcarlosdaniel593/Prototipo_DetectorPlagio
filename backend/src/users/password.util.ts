import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const PREFIX = 'scrypt';

/**
 * Cifra una contraseña con scrypt (incluido en Node.js, sin dependencias nativas).
 * Formato guardado: scrypt$<sal en hex>$<hash en hex>
 * IMPORTANTE: scripts/hash-existing-passwords.js usa este mismo formato.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  return `${PREFIX}$${salt}$${derived.toString('hex')}`;
}

/** Comprueba una contraseña contra el valor guardado (para un futuro login). */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [prefix, salt, hashHex] = stored.split('$');
  if (prefix !== PREFIX || !salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const derived = await scryptAsync(password, salt, expected.length);
  return timingSafeEqual(derived, expected);
}

export function isHashedPassword(value: string): boolean {
  return value.startsWith(`${PREFIX}$`);
}
