# Vault Keep

Password manager pribadi. Semua akun disimpan di satu file terenkripsi, `vault.json`. Versi 1.0.0.

Ada dua cara memakainya, dengan file yang sama:

| Mode | Dipakai untuk | Bisa tambah, edit, hapus |
|---|---|---|
| **Localhost** (Node.js, di Termux atau komputer) | Mengelola isi vault | Ya |
| **Portable** (`vault-keep-portable.html`) | Membuka dan menyalin password di HP atau komputer mana pun tanpa setup | Tidak, baca saja |

Pindah HP? Bawa `vault.json` dan `vault-keep-portable.html`, buka HTML-nya di browser, pilih file, masukkan master password. Selesai.

## Keamanan

- Enkripsi AES-256-GCM, kunci diturunkan dari master password dengan PBKDF2-SHA-256, 600.000 iterasi.
- Salt dan IV acak untuk setiap penyimpanan. Header format ikut diautentikasi (AAD `VaultKeep:v1`).
- Master password tidak pernah disimpan, di disk maupun di memori server setelah vault dikunci.
- Server hanya mendengarkan `127.0.0.1`, menolak Host dan Origin asing, dan memakai Content Security Policy ketat.
- Kunci otomatis setelah 5 menit tidak aktif (localhost dan portable). Lima kali salah password menahan percobaan berikutnya selama 30 detik.
- Penulisan atomik: ditulis ke file sementara, versi lama disalin ke `vault.json.bak`, baru di-rename.
- Password yang disalin dikosongkan dari clipboard setelah 30 detik, kalau browser mengizinkan.
- Tanpa dependensi npm. Tidak ada paket pihak ketiga di server, tidak ada koneksi keluar.

**Penting:** kalau master password lupa, isi vault tidak bisa dipulihkan. Tidak ada reset. Simpan salinan `vault.json` di tempat aman (cloud pribadi, flashdisk). File itu aman dibawa karena terenkripsi, tapi password yang lemah tetap bisa ditebak, jadi pakai master password yang panjang.

## Menjalankan (localhost)

Butuh Node.js 18 atau lebih baru. Di Termux:

```bash
pkg install nodejs
cd vault-keep
npm start
```

Buka `http://localhost:3000` di browser. Saat pertama kali, kamu diminta membuat master password (minimal 12 karakter). Vault dibuat di `data/vault.json`.

Pengaturan lewat environment variable:

```bash
PORT=3001 npm start            # ganti port
IDLE_MINUTES=10 npm start      # ganti waktu kunci otomatis (1 sampai 60)
VAULT_PATH=/path/ke/vault.json npm start   # simpan vault di lokasi lain
```

Tidak perlu `npm install`, karena tidak ada dependensi.

## Memakai mode portable

1. Di localhost, tekan **Unduh vault.json** (atau ambil `data/vault.json`). Kamu juga bisa mengunduh HTML portable dari `http://localhost:3000/portable`.
2. Kirim kedua file ke HP atau komputer tujuan.
3. Buka `vault-keep-portable.html` di browser, pilih `vault.json`, masukkan master password.
4. Cari akun, tekan **Salin** untuk menyalin password.

Mode portable tidak menulis apa pun. Kalau ada akun baru, tambahkan lewat localhost lalu bawa `vault.json` yang terbaru.

## Struktur

```
vault-keep/
├── server/
│   ├── index.js      server HTTP, header keamanan, file statis
│   ├── routes.js     API, sesi, pembatas percobaan salah password
│   ├── store.js      logika vault, validasi, penulisan atomik
│   └── crypto.js     AES-256-GCM dan PBKDF2
├── public/           antarmuka localhost (index.html, app.js, style.css)
├── portable/
│   └── vault-keep-portable.html   satu file mandiri, baca saja
├── data/             vault.json dibuat otomatis (tidak masuk git)
├── package.json
└── .gitignore
```

## Format vault.json

```json
{
  "app": "VaultKeep",
  "version": 1,
  "cipher": "AES-256-GCM",
  "kdf": "PBKDF2-SHA-256",
  "iterations": 600000,
  "salt": "base64, 16 byte",
  "iv": "base64, 12 byte",
  "ciphertext": "base64, isi terenkripsi diikuti tag GCM 16 byte",
  "updatedAt": "waktu ISO"
}
```

Isi setelah didekripsi:

```json
{
  "schemaVersion": 1,
  "createdAt": "...",
  "updatedAt": "...",
  "accounts": [
    { "id": "...", "platform": "", "username": "", "password": "", "category": "Personal", "url": "", "notes": "", "createdAt": "", "updatedAt": "" }
  ]
}
```

Format ini tidak sama dengan `PasswordVault.html` lama, jadi vault lama tidak bisa dibuka langsung. Pindahkan akun lama dengan menambahkannya lewat localhost.

## Kategori

Personal, Finance, Social Media, Work, Gaming, Shopping, Other.

## Pemecahan masalah

| Gejala | Penyebab dan solusi |
|---|---|
| `Port 3000 sudah dipakai` | Jalankan `PORT=3001 npm start`. |
| `Master password salah` padahal yakin benar | Cek huruf besar dan spasi. Kalau file diubah manual, pulihkan dari `vault.json.bak`. |
| `Browser ini tidak mendukung Web Crypto` (portable) | Pakai Chrome atau Firefox versi terbaru. |
| Tombol Salin gagal | Izinkan akses clipboard di browser, atau tekan Lihat lalu salin manual. |
| Halaman localhost tidak terbuka | Pastikan `npm start` masih berjalan. Alamatnya harus `localhost` atau `127.0.0.1`. |

## Lisensi

Pakai pribadi.
