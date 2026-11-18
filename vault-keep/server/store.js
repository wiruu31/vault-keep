import { access, copyFile, mkdir, open, readFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import {
  BadFormatError, ITERATIONS, WrongPasswordError,
  decryptVault, deriveKey, encryptVault, newSalt, parseEnvelope,
} from './crypto.js';

export const CATEGORIES = ['Personal', 'Finance', 'Social Media', 'Work', 'Gaming', 'Shopping', 'Other'];
export const MIN_MASTER_LENGTH = 12;

export class VaultError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function text(value, label, max, { required = false, keepSpaces = false } = {}) {
  const raw = value ?? '';
  if (typeof raw !== 'string') throw new VaultError(400, 'invalid_request', `${label} harus berupa teks.`);
  const clean = keepSpaces ? raw : raw.trim();
  if (required && clean.length === 0) throw new VaultError(400, 'invalid_request', `${label} wajib diisi.`);
  if (clean.length > max) throw new VaultError(400, 'invalid_request', `${label} maksimal ${max} karakter.`);
  return clean;
}

function cleanAccount(input) {
  if (!input || typeof input !== 'object') throw new VaultError(400, 'invalid_request', 'Data akun tidak terbaca.');
  const category = input.category ?? 'Personal';
  if (!CATEGORIES.includes(category)) throw new VaultError(400, 'invalid_request', 'Kategori tidak dikenal.');
  return {
    platform: text(input.platform, 'Platform', 120, { required: true }),
    username: text(input.username, 'Username', 200),
    password: text(input.password, 'Password', 1000, { required: true, keepSpaces: true }),
    category,
    url: text(input.url, 'URL', 500),
    notes: text(input.notes, 'Catatan', 2000),
  };
}

function checkVaultData(data) {
  const ok = data && data.schemaVersion === 1 && Array.isArray(data.accounts) &&
    data.accounts.every((a) => a && ['id', 'platform', 'username', 'password'].every((k) => typeof a[k] === 'string'));
  if (!ok) throw new BadFormatError('Struktur data di dalam vault tidak valid.');
}

export function createStore(path) {
  let session = null;
  let queue = Promise.resolve();

  async function exists() {
    try { await access(path); return true; } catch { return false; }
  }

  // Tulis ke file sementara, backup versi lama, lalu rename: vault.json tidak pernah setengah tertulis.
  function persist(s) {
    const job = queue.then(async () => {
      const envelope = encryptVault(s.data, s.key, s.salt, s.iterations);
      const tmp = `${path}.tmp`;
      await mkdir(dirname(path), { recursive: true });
      const file = await open(tmp, 'w', 0o600);
      try {
        await file.writeFile(JSON.stringify(envelope, null, 2));
        await file.sync();
      } finally {
        await file.close();
      }
      try { await copyFile(path, `${path}.bak`); } catch (err) { if (err.code !== 'ENOENT') throw err; }
      await rename(tmp, path);
    });
    queue = job.catch(() => {});
    return job;
  }

  function requireSession() {
    if (!session) throw new VaultError(401, 'locked', 'Vault terkunci. Masukkan master password lagi.');
    return session;
  }

  async function commit(nextData) {
    const s = requireSession();
    const previous = s.data;
    s.data = nextData;
    try {
      await persist(s);
    } catch (err) {
      s.data = previous;
      throw new VaultError(500, 'write_failed', 'Gagal menulis vault.json. Perubahan dibatalkan. Cek ruang penyimpanan lalu coba lagi.');
    }
  }

  return {
    exists,
    isUnlocked: () => session !== null,

    async create(password) {
      if (typeof password !== 'string' || password.length < MIN_MASTER_LENGTH) {
        throw new VaultError(400, 'weak_password', `Master password minimal ${MIN_MASTER_LENGTH} karakter.`);
      }
      if (await exists()) throw new VaultError(409, 'vault_exists', 'Vault sudah ada. Buka dengan master password.');
      const salt = newSalt();
      const now = new Date().toISOString();
      const next = {
        key: await deriveKey(password, salt, ITERATIONS),
        salt,
        iterations: ITERATIONS,
        data: { schemaVersion: 1, createdAt: now, updatedAt: now, accounts: [] },
      };
      try {
        await persist(next);
      } catch {
        throw new VaultError(500, 'write_failed', 'Gagal membuat data/vault.json. Cek izin folder dan ruang penyimpanan.');
      }
      session = next;
    },

    async unlock(password) {
      if (typeof password !== 'string' || password.length === 0) {
        throw new VaultError(400, 'invalid_request', 'Master password wajib diisi.');
      }
      let raw;
      try {
        raw = await readFile(path, 'utf8');
      } catch {
        throw new VaultError(404, 'no_vault', 'Belum ada vault. Buat vault baru dulu.');
      }
      let parts;
      let data;
      let key;
      try {
        parts = parseEnvelope(JSON.parse(raw));
        key = await deriveKey(password, parts.salt, parts.iterations);
        data = decryptVault(parts, key);
        checkVaultData(data);
      } catch (err) {
        if (err instanceof WrongPasswordError) throw err;
        throw new VaultError(500, 'vault_unreadable', 'vault.json tidak bisa dibaca. Pulihkan dari vault.json.bak atau dari salinanmu.');
      }
      session = { key, salt: parts.salt, iterations: parts.iterations, data };
    },

    lock() { session = null; },

    list: () => requireSession().data.accounts.slice(),

    async add(input) {
      const s = requireSession();
      const now = new Date().toISOString();
      const account = { id: randomUUID().replaceAll('-', ''), ...cleanAccount(input), createdAt: now, updatedAt: now };
      await commit({ ...s.data, updatedAt: now, accounts: [...s.data.accounts, account] });
      return account;
    },

    async update(id, input) {
      const s = requireSession();
      const current = s.data.accounts.find((a) => a.id === id);
      if (!current) throw new VaultError(404, 'not_found', 'Akun tidak ditemukan. Segarkan daftar.');
      const now = new Date().toISOString();
      const account = { ...current, ...cleanAccount(input), updatedAt: now };
      await commit({ ...s.data, updatedAt: now, accounts: s.data.accounts.map((a) => (a.id === id ? account : a)) });
      return account;
    },

    async remove(id) {
      const s = requireSession();
      if (!s.data.accounts.some((a) => a.id === id)) throw new VaultError(404, 'not_found', 'Akun tidak ditemukan. Segarkan daftar.');
      await commit({ ...s.data, updatedAt: new Date().toISOString(), accounts: s.data.accounts.filter((a) => a.id !== id) });
    },

    async rawFile() {
      requireSession();
      try { return await readFile(path); } catch { throw new VaultError(404, 'no_vault', 'File vault.json belum ada.'); }
    },
  };
}
