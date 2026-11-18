'use strict';

const CATEGORIES = ['Personal', 'Finance', 'Social Media', 'Work', 'Gaming', 'Shopping', 'Other'];
const MIN_MASTER = 12;
const CLIPBOARD_CLEAR_MS = 30000;
const $ = (id) => document.getElementById(id);

const state = { token: null, accounts: [], selectedId: null, mode: 'none', query: '', category: 'all', vaultExists: false, revealed: false };
let toastTimer = null;
let pollTimer = null;
let clipTimer = null;

// API

async function api(method, url, body) {
  const headers = {};
  if (state.token) headers['x-vault-token'] = state.token;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new Error('Server tidak terjangkau. Pastikan npm start masih berjalan di Termux.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && data.error === 'locked') {
      showGate('Vault terkunci karena tidak aktif. Masukkan master password lagi.');
    }
    const err = new Error(data.message || 'Permintaan gagal.');
    err.code = data.error;
    throw err;
  }
  return data;
}

// Gate

function setGateMode(creating) {
  $('gate-title').textContent = creating ? 'Buat vault baru' : 'Buka vault';
  $('gate-hint').textContent = creating
    ? 'Belum ada vault.json. Pilih master password untuk membuatnya.'
    : 'Masukkan master password untuk membuka vault.json.';
  $('gate-confirm-wrap').hidden = !creating;
  $('gate-submit').textContent = creating ? 'Buat vault' : 'Buka';
  $('gate-pass').autocomplete = creating ? 'new-password' : 'current-password';
}

function gateError(msg) {
  const el = $('gate-error');
  el.textContent = msg || '';
  el.hidden = !msg;
}

function showGate(message) {
  clearInterval(pollTimer);
  state.token = null;
  state.accounts = [];
  state.selectedId = null;
  state.mode = 'none';
  setGateMode(!state.vaultExists);
  $('app').hidden = true;
  $('gate').hidden = false;
  $('gate-pass').value = '';
  $('gate-confirm').value = '';
  gateError(message || '');
  $('gate-pass').focus();
}

async function init() {
  fillCategorySelects();
  try {
    const status = await api('GET', '/api/status');
    state.vaultExists = status.exists;
    setGateMode(!status.exists);
  } catch (err) {
    gateError(err.message);
  }
  $('gate-pass').focus();
}

async function submitGate(event) {
  event.preventDefault();
  gateError('');
  const password = $('gate-pass').value;
  const creating = !state.vaultExists;
  if (creating) {
    if (password.length < MIN_MASTER) return gateError(`Master password minimal ${MIN_MASTER} karakter.`);
    if (password !== $('gate-confirm').value) return gateError('Ulangi master password dengan teks yang sama.');
  } else if (!password) {
    return gateError('Master password wajib diisi.');
  }
  const button = $('gate-submit');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = creating ? 'Membuat...' : 'Membuka...';
  try {
    const { token } = await api('POST', creating ? '/api/create' : '/api/unlock', { password });
    state.token = token;
    state.vaultExists = true;
    $('gate-pass').value = '';
    $('gate-confirm').value = '';
    await enterApp();
  } catch (err) {
    gateError(err.code === 'wrong_password' ? 'Master password salah.' : err.message);
  } finally {
    button.disabled = false;
    button.textContent = state.vaultExists ? 'Buka' : label;
  }
}

// App

async function enterApp() {
  $('gate').hidden = true;
  $('app').hidden = false;
  $('loading').hidden = false;
  $('rows').replaceChildren();
  $('empty').hidden = true;
  await loadAccounts();
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const s = await api('GET', '/api/status');
      if (!s.unlocked) showGate('Vault terkunci karena tidak aktif. Masukkan master password lagi.');
    } catch { /* The next tick retries. */ }
  }, 20000);
}

async function loadAccounts() {
  try {
    const { accounts } = await api('GET', '/api/accounts');
    state.accounts = accounts;
  } catch (err) {
    if (!$('app').hidden) toast(err.message);
  }
  $('loading').hidden = true;
  render();
}

function fillCategorySelects() {
  const filter = $('cat');
  filter.replaceChildren(new Option('Semua kategori', 'all'));
  CATEGORIES.forEach((c) => filter.append(new Option(c, c)));
  const form = $('f-cat');
  form.replaceChildren();
  CATEGORIES.forEach((c) => form.append(new Option(c, c)));
}

function filtered() {
  const q = state.query.trim().toLowerCase();
  return state.accounts
    .filter((a) => state.category === 'all' || a.category === state.category)
    .filter((a) => !q || [a.platform, a.username, a.url, a.notes].some((v) => (v || '').toLowerCase().includes(q)))
    .sort((a, b) => a.platform.localeCompare(b.platform, 'id', { sensitivity: 'base' }));
}

function fmtDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function render() {
  const list = filtered();
  const rows = $('rows');
  rows.replaceChildren();
  list.forEach((a) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'row';
    btn.dataset.id = a.id;
    if (a.id === state.selectedId) btn.setAttribute('aria-current', 'true');
    [['r-platform', a.platform], ['r-user', a.username || 'tanpa username'], ['c-cat', a.category], ['c-date', fmtDate(a.updatedAt)]].forEach(([cls, text]) => {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = text;
      btn.append(span);
    });
    btn.setAttribute('aria-label', `${a.platform}, ${a.username || 'tanpa username'}`);
    li.append(btn);
    rows.append(li);
  });

  const total = state.accounts.length;
  $('count').textContent = total ? `${list.length} dari ${total} akun` : '';
  const empty = $('empty');
  empty.hidden = list.length > 0;
  if (!list.length) {
    $('empty-title').textContent = total ? 'Tidak ada akun yang cocok.' : 'Vault masih kosong.';
    $('empty-body').textContent = total ? 'Ubah kata kunci atau pilih kategori lain.' : 'Tekan Tambah untuk menyimpan akun pertama.';
  }

  const open = state.mode !== 'none';
  $('panel').hidden = !open;
  document.querySelector('.work').classList.toggle('has-panel', open);
  $('detail').hidden = state.mode !== 'view';
  $('form').hidden = !(state.mode === 'edit' || state.mode === 'new');
  if (state.mode === 'view') renderDetail();
}

function selected() {
  return state.accounts.find((a) => a.id === state.selectedId);
}

function renderDetail() {
  const a = selected();
  if (!a) { state.mode = 'none'; return render(); }
  $('d-title').textContent = a.platform;
  $('d-user').textContent = a.username || 'Tidak diisi';
  $('d-copy-user').hidden = !a.username;
  $('d-pass').textContent = state.revealed ? a.password : '•'.repeat(Math.min(a.password.length, 16));
  $('d-reveal').textContent = state.revealed ? 'Sembunyi' : 'Lihat';
  $('d-reveal').setAttribute('aria-pressed', String(state.revealed));
  $('d-cat').textContent = a.category;
  $('d-notes').textContent = a.notes || 'Tidak ada catatan';
  $('d-date').textContent = fmtDate(a.updatedAt);
  const urlCell = $('d-url');
  urlCell.replaceChildren();
  const safe = /^https?:\/\//i.test(a.url || '');
  if (safe) {
    const link = document.createElement('a');
    link.href = a.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = a.url;
    urlCell.append(link);
  } else {
    urlCell.textContent = a.url || 'Tidak diisi';
  }
  $('d-confirm').hidden = true;
}

function openDetail(id) {
  state.selectedId = id;
  state.mode = 'view';
  state.revealed = false;
  render();
  $('d-title').scrollIntoView({ block: 'nearest' });
}

function closePanel() {
  state.mode = 'none';
  state.revealed = false;
  render();
}

// Form

function openForm(mode) {
  const a = mode === 'edit' ? selected() : null;
  state.mode = mode;
  $('f-title').textContent = mode === 'edit' ? `Edit ${a.platform}` : 'Akun baru';
  $('f-platform').value = a ? a.platform : '';
  $('f-user').value = a ? a.username : '';
  $('f-pass').value = a ? a.password : '';
  $('f-pass').type = 'password';
  $('f-toggle').textContent = 'Lihat';
  $('f-toggle').setAttribute('aria-pressed', 'false');
  $('f-cat').value = a ? a.category : 'Personal';
  $('f-url').value = a ? a.url : '';
  $('f-notes').value = a ? a.notes : '';
  $('f-error').hidden = true;
  render();
  $('f-platform').focus();
}

function formError(msg) {
  const el = $('f-error');
  el.textContent = msg;
  el.hidden = false;
}

async function saveForm(event) {
  event.preventDefault();
  const body = {
    platform: $('f-platform').value,
    username: $('f-user').value,
    password: $('f-pass').value,
    category: $('f-cat').value,
    url: $('f-url').value,
    notes: $('f-notes').value,
  };
  if (!body.platform.trim()) return formError('Platform wajib diisi.');
  if (!body.password) return formError('Password wajib diisi.');
  const button = $('f-save');
  button.disabled = true;
  button.textContent = 'Menyimpan...';
  try {
    const editing = state.mode === 'edit';
    const { account } = editing
      ? await api('PUT', `/api/accounts/${state.selectedId}`, body)
      : await api('POST', '/api/accounts', body);
    if (editing) state.accounts = state.accounts.map((a) => (a.id === account.id ? account : a));
    else state.accounts.push(account);
    toast(editing ? 'Perubahan tersimpan.' : 'Akun ditambahkan.');
    openDetail(account.id);
  } catch (err) {
    formError(err.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Simpan';
  }
}

function generatePassword(length, symbols) {
  const sets = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789'];
  if (symbols) sets.push('!@#$%^&*-_=+?');
  const all = sets.join('');
  const pick = (chars) => {
    const limit = 256 - (256 % chars.length);
    const buf = new Uint8Array(1);
    do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
    return chars[buf[0] % chars.length];
  };
  const out = sets.map(pick);
  while (out.length < length) out.push(pick(all));
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

// Actions

async function removeSelected() {
  const button = $('d-yes');
  button.disabled = true;
  try {
    await api('DELETE', `/api/accounts/${state.selectedId}`);
    state.accounts = state.accounts.filter((a) => a.id !== state.selectedId);
    state.selectedId = null;
    state.mode = 'none';
    toast('Akun dihapus.');
    render();
  } catch (err) {
    toast(err.message);
  } finally {
    button.disabled = false;
  }
}

async function copy(text, label) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return toast('Gagal menyalin. Izinkan akses clipboard di browser.');
  }
  toast(`${label} disalin. Clipboard dikosongkan dalam 30 detik.`);
  clearTimeout(clipTimer);
  clipTimer = setTimeout(async () => {
    try {
      if ((await navigator.clipboard.readText()) === text) await navigator.clipboard.writeText('');
    } catch { /* Clipboard read can be blocked; nothing else to do. */ }
  }, CLIPBOARD_CLEAR_MS);
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

async function lock() {
  try { await api('POST', '/api/lock'); } catch { /* Locking the screen below still applies. */ }
  showGate('');
}

function togglePassword(input, button) {
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  button.textContent = show ? 'Sembunyi' : 'Lihat';
  button.setAttribute('aria-pressed', String(show));
}

// Wiring

$('gate-form').addEventListener('submit', submitGate);
$('gate-toggle').addEventListener('click', () => togglePassword($('gate-pass'), $('gate-toggle')));
$('f-toggle').addEventListener('click', () => togglePassword($('f-pass'), $('f-toggle')));
$('q').addEventListener('input', (e) => { state.query = e.target.value; render(); });
$('cat').addEventListener('change', (e) => { state.category = e.target.value; render(); });
$('btn-new').addEventListener('click', () => openForm('new'));
$('btn-lock').addEventListener('click', lock);
$('rows').addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (row) openDetail(row.dataset.id);
});
$('d-close').addEventListener('click', closePanel);
$('f-close').addEventListener('click', () => (state.mode === 'edit' ? openDetail(state.selectedId) : closePanel()));
$('d-edit').addEventListener('click', () => openForm('edit'));
$('d-delete').addEventListener('click', () => { $('d-confirm').hidden = false; $('d-no').focus(); });
$('d-no').addEventListener('click', () => { $('d-confirm').hidden = true; $('d-delete').focus(); });
$('d-yes').addEventListener('click', removeSelected);
$('d-reveal').addEventListener('click', () => { state.revealed = !state.revealed; renderDetail(); });
$('d-copy-user').addEventListener('click', () => copy(selected().username, 'Username'));
$('d-copy-pass').addEventListener('click', () => copy(selected().password, 'Password'));
$('form').addEventListener('submit', saveForm);
$('g-make').addEventListener('click', () => {
  const len = Math.min(64, Math.max(12, Number($('g-len').value) || 20));
  $('g-len').value = len;
  $('f-pass').value = generatePassword(len, $('g-sym').checked);
  $('f-pass').type = 'text';
  $('f-toggle').textContent = 'Sembunyi';
  $('f-toggle').setAttribute('aria-pressed', 'true');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.mode !== 'none' && !$('app').hidden) {
    state.mode === 'edit' ? openDetail(state.selectedId) : closePanel();
  }
});

init();
