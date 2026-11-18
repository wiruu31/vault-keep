import { createCipheriv, createDecipheriv, pbkdf2, randomBytes } from 'node:crypto';

export const FORMAT = 'VaultKeep';
export const VERSION = 1;
export const ITERATIONS = 600000;

const CIPHER = 'AES-256-GCM';
const KDF = 'PBKDF2-SHA-256';
const TAG_BYTES = 16;
const AAD = Buffer.from('VaultKeep:v1');

export class WrongPasswordError extends Error {}
export class BadFormatError extends Error {}

export const newSalt = () => randomBytes(16);

export function deriveKey(password, salt, iterations) {
  return new Promise((resolve, reject) => {
    pbkdf2(password, salt, iterations, 32, 'sha256', (err, key) => (err ? reject(err) : resolve(key)));
  });
}

// Tag GCM ditempel di akhir ciphertext, sama seperti keluaran Web Crypto di mode portable.
export function encryptVault(data, key, salt, iterations = ITERATIONS) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(AAD);
  const body = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return {
    app: FORMAT,
    version: VERSION,
    cipher: CIPHER,
    kdf: KDF,
    iterations,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    ciphertext: Buffer.concat([body, cipher.getAuthTag()]).toString('base64'),
    updatedAt: new Date().toISOString(),
  };
}

export function parseEnvelope(env) {
  if (!env || env.app !== FORMAT || env.version !== VERSION || env.cipher !== CIPHER || env.kdf !== KDF) {
    throw new BadFormatError('Format file tidak dikenali atau versinya tidak didukung.');
  }
  if (!Number.isInteger(env.iterations) || env.iterations < 100000 || env.iterations > 1500000) {
    throw new BadFormatError('Parameter keamanan di vault.json tidak valid.');
  }
  if (typeof env.salt !== 'string' || typeof env.iv !== 'string' || typeof env.ciphertext !== 'string') {
    throw new BadFormatError('Isi vault.json tidak lengkap.');
  }
  const salt = Buffer.from(env.salt, 'base64');
  const iv = Buffer.from(env.iv, 'base64');
  const ciphertext = Buffer.from(env.ciphertext, 'base64');
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length <= TAG_BYTES) {
    throw new BadFormatError('Struktur vault.json tidak valid.');
  }
  return { salt, iv, ciphertext, iterations: env.iterations };
}

export function decryptVault(parts, key) {
  const body = parts.ciphertext.subarray(0, -TAG_BYTES);
  const tag = parts.ciphertext.subarray(-TAG_BYTES);
  let plain;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, parts.iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    plain = Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new WrongPasswordError();
  }
  return JSON.parse(plain.toString('utf8'));
}
