import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi, sendJson } from './routes.js';
import { createStore } from './store.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const HOST = '0.0.0.0';
const PORT = Number(process.env.PORT) || 3000;
const IDLE_MINUTES = Math.min(60, Math.max(1, Number(process.env.IDLE_MINUTES) || 5));
const VAULT_PATH = process.env.VAULT_PATH ? resolve(process.env.VAULT_PATH) : join(ROOT, 'data', 'vault.json');

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`PORT tidak valid: "${process.env.PORT}". Pakai angka 1 sampai 65535.`);
  process.exit(1);
}

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const ALLOWED_HOSTS = new Set([
  `127.0.0.1:${PORT}`,
  `localhost:${PORT}`
]);

// Daftar tetap: tidak ada jalur file dari URL yang dipakai untuk membaca disk.
const STATIC = {
  '/': ['public/index.html', 'text/html; charset=utf-8'],
  '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['public/style.css', 'text/css; charset=utf-8'],
  '/portable': ['portable/vault-keep-portable.html', 'text/html; charset=utf-8', 'attachment; filename="vault-keep-portable.html"'],
};

const store = createStore(VAULT_PATH);
const handleApi = createApi({ store, idleMs: IDLE_MINUTES * 60000 });

async function serveStatic(req, res, pathname) {
  const entry = STATIC[pathname];
  if (!entry || (req.method !== 'GET' && req.method !== 'HEAD')) {
    return sendJson(res, 404, { error: 'not_found', message: 'Halaman tidak ada.' });
  }
  try {
    const body = await readFile(join(ROOT, entry[0]));
    const headers = { 'content-type': entry[1], 'cache-control': 'no-store' };
    if (entry[2]) headers['content-disposition'] = entry[2];
    res.writeHead(200, headers);
    return res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    return sendJson(res, 500, { error: 'file_missing', message: 'File aplikasi tidak ditemukan di server.' });
  }
}

const server = createServer(async (req, res) => {
  res.setHeader('content-security-policy', CSP);
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');

  // Menolak Host dan Origin asing menutup serangan DNS rebinding dan form lintas situs.
  if (!ALLOWED_HOSTS.has(req.headers.host)) {
    return sendJson(res, 403, { error: 'bad_host', message: 'Akses hanya lewat 127.0.0.1 atau localhost.' });
  }
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}`) {
    return sendJson(res, 403, { error: 'bad_origin', message: 'Asal permintaan ditolak.' });
  }

  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);
  return serveStatic(req, res, pathname);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} sudah dipakai. Hentikan proses lain atau jalankan: PORT=3001 npm start`);
  } else {
    console.error('Server gagal berjalan:', err.message);
  }
  process.exit(1);
});

function shutdown() {
  store.lock();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, HOST, () => {
  console.log(`Vault Keep v1.0.0 berjalan di http://localhost:${PORT}`);
  console.log(`Vault Keep v1.0.0 berjalan di http://127.0.0.1:${PORT}`);
  console.log(`Vault: ${VAULT_PATH}`);
  console.log(`Kunci otomatis setelah ${IDLE_MINUTES} menit tidak aktif. Tekan Ctrl+C untuk berhenti.`);
});
