import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WrongPasswordError } from './crypto.js';
import { VaultError } from './store.js';

const MAX_BODY = 256 * 1024;
const MAX_FAILS = 5;
const BLOCK_MS = 30000;
const ACCOUNT_PATH = /^\/api\/accounts\/([a-f0-9]{32})$/;

export function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new VaultError(413, 'too_large', 'Permintaan terlalu besar.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bukan objek');
        resolve(parsed);
      } catch {
        reject(new VaultError(400, 'invalid_json', 'Isi permintaan bukan JSON yang valid.'));
      }
    });
    req.on('error', reject);
  });
}

export function createApi({ store, idleMs }) {
  let token = null;
  let idleTimer = null;
  let fails = 0;
  let blockedUntil = 0;

  function endSession() {
    token = null;
    clearTimeout(idleTimer);
    store.lock();
  }

  function startSession() {
    token = randomBytes(24).toString('base64url');
    touch();
    return token;
  }

  function touch() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(endSession, idleMs);
    idleTimer.unref();
  }

  function isAuthed(req) {
    const sent = req.headers['x-vault-token'];
    if (!token || typeof sent !== 'string') return false;
    const a = Buffer.from(sent);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  function needAuth(req) {
    if (!isAuthed(req)) throw new VaultError(401, 'locked', 'Vault terkunci. Masukkan master password lagi.');
    touch();
  }

  function checkBlock() {
    const wait = Math.ceil((blockedUntil - Date.now()) / 1000);
    if (wait > 0) throw new VaultError(429, 'too_many_attempts', `Terlalu banyak percobaan. Tunggu ${wait} detik.`);
  }

  async function guessGuard(work) {
    checkBlock();
    try {
      await work();
      fails = 0;
    } catch (err) {
      if (err instanceof WrongPasswordError) {
        fails += 1;
        if (fails >= MAX_FAILS) {
          fails = 0;
          blockedUntil = Date.now() + BLOCK_MS;
        }
      }
      throw err;
    }
  }

  const routes = [
    ['GET', '/api/status', async (req, res) => {
      sendJson(res, 200, { exists: await store.exists(), unlocked: isAuthed(req) && store.isUnlocked() });
    }],
    ['POST', '/api/create', async (req, res) => {
      const { password } = await readJson(req);
      await guessGuard(() => store.create(password));
      sendJson(res, 201, { token: startSession() });
    }],
    ['POST', '/api/unlock', async (req, res) => {
      const { password } = await readJson(req);
      await guessGuard(() => store.unlock(password));
      sendJson(res, 200, { token: startSession() });
    }],
    ['POST', '/api/lock', async (req, res) => {
      if (isAuthed(req)) endSession();
      sendJson(res, 200, { locked: true });
    }],
    ['GET', '/api/accounts', async (req, res) => {
      needAuth(req);
      sendJson(res, 200, { accounts: store.list() });
    }],
    ['POST', '/api/accounts', async (req, res) => {
      needAuth(req);
      sendJson(res, 201, { account: await store.add(await readJson(req)) });
    }],
    ['PUT', ACCOUNT_PATH, async (req, res, match) => {
      needAuth(req);
      sendJson(res, 200, { account: await store.update(match[1], await readJson(req)) });
    }],
    ['DELETE', ACCOUNT_PATH, async (req, res, match) => {
      needAuth(req);
      await store.remove(match[1]);
      sendJson(res, 200, { deleted: true });
    }],
    ['GET', '/api/export', async (req, res) => {
      needAuth(req);
      const file = await store.rawFile();
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': 'attachment; filename="vault.json"',
        'cache-control': 'no-store',
      });
      res.end(file);
    }],
  ];

  return async function handleApi(req, res, pathname) {
    try {
      let pathKnown = false;
      for (const [method, pattern, handler] of routes) {
        const match = typeof pattern === 'string' ? (pattern === pathname ? [] : null) : pattern.exec(pathname);
        if (!match) continue;
        pathKnown = true;
        if (method !== req.method) continue;
        await handler(req, res, match);
        return;
      }
      if (pathKnown) throw new VaultError(405, 'method_not_allowed', 'Metode tidak didukung untuk alamat ini.');
      throw new VaultError(404, 'not_found', 'Alamat API tidak ada.');
    } catch (err) {
      if (err instanceof VaultError) return sendJson(res, err.status, { error: err.code, message: err.message });
      if (err instanceof WrongPasswordError) return sendJson(res, 401, { error: 'wrong_password', message: 'Master password salah.' });
      console.error('Kesalahan tak terduga:', err.name);
      return sendJson(res, 500, { error: 'internal_error', message: 'Terjadi kesalahan di server.' });
    }
  };
}
