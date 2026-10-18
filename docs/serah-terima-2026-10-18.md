# Serah terima Pasla, 18 Oktober 2026

Plan penuh belum lulus. Mulai dari `tasks/todo.md`, `docs/riset-v2-preview.md`
dan `eval/README.md`; dokumen 16 Oktober adalah konteks historis.

## Rilis dan repositori

- Mesin: cabang `riset/fase-0`; API v2 aktif `ac1bfba` (putusan MK BPK).
  Commit sesudahnya hanya kolektor evaluasi, pengujian dan dokumen; tidak perlu
  mengganti layanan aktif untuk kolektor lokal tersebut.
- Web: cabang `codex/ruang-riset`, kode `8504424`; deployment preview
  `0956fb9c.pasla.pages.dev`, alias `riset.pasla.pages.dev`.
- Produksi tetap memerlukan evaluasi dan keputusan pemilik; akun preview
  dibatasi satu email terverifikasi yang sebelumnya disetujui.

## Verifikasi yang benar-benar dilakukan

- Verify mesin: 131 uji TypeScript utama beserta fondasi/parser, lint/OpenAPI,
  typecheck, build, PDF dist dan build web bawaan lulus. Lima uji kolektor v2
  beserta typecheck terpisah lulus pada versi akhir kolektor.
- Web terbaru: 18 lokal, 32 Workers, 8 operasi, build/typecheck lulus. Sebanyak
  34 Chromium/WebKit lulus sebelum penajaman bootstrap metadata, lalu 12 kasus
  fokus pemuatan akun/penghapusan perangkat lulus sesudahnya. Daftar laporan
  akun pada perangkat baru teruji dengan fixture; login Google kedua belum.
  Pengaman transaksi mempertahankan draf lokal dan menolak respons lama sesudah
  salinan perangkat dihapus, termasuk penghapusan dari tab versi lama.
  Probe HTTPS 10:16:14 UTC lulus preview/mesin/tanda tangan tanpa AI; satu sumber
  926 ms bukan bukti kelulusan performa. Brave tidak tersedia untuk screenshot baru.
- Pembaruan uji web `3e80f4a` memeriksa laporan bertanda tangan setelah reload,
  pemulihan akun fixture dari konteks kosong dan ekspor Markdown/DOCX dengan
  kalimat serta nomor catatan kaki yang terhubung. Seluruh 34 Chromium/WebKit,
  18 lokal, 32 Workers, 8 operasi dan typecheck lulus pada versi akhir uji.
  DOCX contoh satu halaman dari kedua browser dirender/diperiksa lewat LibreOffice
  26.2.4.2, termasuk Latin/Arab. Tidak ada perubahan runtime/deploy atau AI berbayar.
  Ini bukan login Google kedua, laporan D1/provider nyata, uji penyaringan AI,
  kompatibilitas Microsoft Word atau dokumen panjang.
- MK 33/PUU-XIV/2016 halaman 25 juga dibuka lewat HTTPS publik; hash dan tanda
  tangan terhadap kunci yang dipatok lulus. Tidak ada panggilan AI.
- Empat sumber korpus tetap snapshot parsial. Qanun 6/2014 menyertakan relasi
  perubahan 12/2025 dalam tanda tangan; belum terkonsolidasi.
- Beban campuran nyata pada proses terpisah dengan MemoryMax 450 MiB, SwapMax 0,
  CPUQuota 50%, PrivateNetwork: tiga gelombang × (dua PDF 112 halaman tanpa cache
  + delapan AI sintetis delay dua detik), 30/30 selesai. Tidak ada biaya provider.
  Konkurensi dan overlap maksimum dua PDF/delapan AI; kedua PID layanan tetap,
  NRestarts nol. Ini belum pengujian latensi/mutu provider nyata.
- Backup AES-256-GCM di komputer operator, restore SQLite memori, dan restore
  snapshot akun kosong ke D1 sementara lulus. D1 uji dihapus; database lama utuh.
  Ini belum restore data akun berisi atau backup di perangkat berbeda.
- Workers Free dan Time Travel D1 tujuh hari dikonfirmasi lewat dasbor.

## Perbaikan yang mudah terlupakan

- Hash tiket dihitung setelah normalisasi bidang pengguna, sesuai schema API.
  Plan hasil suntingan dan draf lama dengan spasi tepi tetap ditangani. Jangan
  merapikan teks potongan atau mengubah metadata yang sudah ditandatangani.
- Turnstile tetap memeriksa HTTP 200, success, hostname dan action `login`.
  Kegagalannya kini berkode configuration/token/expired-or-used/hostname/action/
  service; body provider dan rahasia tidak ditampilkan.
- Wrangler `auth token --json` harus dipanggil dengan WRANGLER_WRITE_LOGS=false
  serta WRANGLER_SEND_METRICS=false dan stdout tertahan. Enam log lama sudah
  direduksi. Jangan mencetak token, env rahasia atau respons API yang berisi secret.

## Infrastruktur yang perlu dijaga

SSH VPS memakai kunci yang sudah tersedia. v1 `pasla-api` di 3101, PID 816288;
v2 `pasla-v2-preview` di 3102, PID 1009161 pada pemeriksaan terakhir. Release
aktif `/opt/pasla-preview/releases/ac1bfba`, korpus
`/var/lib/pasla-preview/research-ac1bfba.sqlite` dan overlay
`/etc/pasla-preview-corpus-ac1bfba.env`. Backup unit
`/etc/systemd/system/pasla-v2-preview.service.before-ac1bfba` serta release/korpus
`8dd6367` dipertahankan. Cloudflared hanya mengarahkan `/v2` ke 3102.

## Pekerjaan berikutnya dan penghambat

1. Login Google nyata berhasil setelah pemilik mematikan debugging browser.
   Profil terlihat, proyek sintetis dibuat/disinkronkan dan bertahan sesudah
   reload; kueri agregat hanya fixture mengonfirmasi satu baris D1 versi 1.
   Pemulihan galat login sudah diterbitkan (JSON, cookie state tetap, reset token,
   penolakan kiriman ganda/BFCache dan kode aman). Screenshot akun/proyek berhasil
   disimpan setelah sambungan pulih. Ekspor nyata 755 byte diperiksa: kebijakan
   18 Oktober dan fixture versi 1 cocok. Logout belum diuji; sesi pemilik tetap
   masuk. Jangan meminta token/secret.
2. KHI utuh belum tersedia. Lampiran katalog resmi perpustakaan MA id 2913/fid
   3858 hanya enam halaman pengantar/daftar isi pindai, tidak diimpor. BPHN masih
   membatasi akses. Tidak ada bypass tantangan. Pemetaan madzhab dan impor putusan
   manual anonim masih perlu diselesaikan.
   Salinan ulang pada situs Madiun (35 halaman) juga ditolak: PDF asli kehilangan
   pasal 124 dan 139. Importer lokal kini menolak celah urutan/batas buku, pasal
   kosong dan daftar isi yang memerlukan kurasi. Lihat docs/riset-v2-preview.md.
   Penelusuran lanjutan menemukan PDF Kemenag 252 halaman dengan Pasal 124/139
   terlihat pada gambar. OCR belum layak: hanya 173 segmen dikenali, impor
   ditolak pada indeks memori kosong. Kandidat dan audit telah disimpan untuk
   kurasi, bukan diimpor. Salinan USU identik Madiun; kandidat Kemenag 2018
   juga gagal penomoran. Rincian/hash pada docs/riset-v2-preview.md.
3. `npm run eval:v2` adalah preflight tanpa jaringan; kolektor lengkap ada tetapi
   tidak ada pengumpulan berbayar. Dilarang membaca butir tertahan. Snapshot,
   temperature nol, penilaian recall/status/jebakan, juri independen, sekitar 40
   label manusia, kunci dan budget belum siap. Jangan menyebut mutu model lulus.
4. Gerbang HTTPS 500 ms belum lulus pada seluruh gelombang sebelumnya (p95
   552,14/319,94/307,56 ms). Uji campuran sintetis tidak menggantikannya.
5. Monitoring ketika komputer mati, alert semua lalu lintas/struktur sumber,
   retensi log jaringan, backup perangkat lain, pemeriksaan Word/dokumen panjang, enam laporan
   manual dan keputusan hukum/produksi masih terbuka.
   Backup sesudah login, dengan satu pengguna/sesi/proyek sintetis, lulus restore
   SQLite memori. Restore D1 remote tetap hanya diuji untuk snapshot kosong.

Jadwal backup harian dan probe per jam sudah dibuat sebagai heartbeat Codex lokal;
komputer/aplikasi yang tidak aktif tetap membatasi pelaksanaannya.
