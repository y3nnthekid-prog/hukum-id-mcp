# Evaluasi enam rumpun

Set uji baku untuk ruang riset Pasla. Keenam rumpunnya:

1. Ilmu Hukum
2. Hukum Ekonomi Syariah
3. Hukum Tata Negara
4. Hukum Keluarga Islam
5. Hukum Pidana Islam
6. Perbandingan Madzhab

Tujuannya mengukur apakah mesin menemukan rujukan yang wajib dipakai, melaporkan status
berlakunya dengan benar, dan menolak dengan benar saat ditanya hal yang tidak ada.

## Isi

- `skema.ts`: bentuk butir (pertanyaan, asal topik, harapan, rujukan wajib, catatan verifikasi).
- `rumpun/<rumpun>.json`: 25 butir per rumpun, lima di antaranya bertanda `tertahan`.
- `rumpun/jebakan.json`: 30 butir jebakan:
  - nomor peraturan atau putusan palsu;
  - pasal yang tidak ada;
  - UU yang sudah dicabut tetapi ditanyakan seolah berlaku;
  - fatwa yang diklaim mengikat.
- `tertahan.sha256`: sidik butir tertahan. Butir tertahan tidak dipakai selama pengembangan;
  sidiknya di-commit supaya isinya tidak bisa diubah diam-diam sesudah hasil terlihat.

## Cara butir disusun dan apa batasnya

- **Topik** diambil dari pokok bahasan baku mata kuliah tiap prodi, misalnya batas usia
  perkawinan, akad murabahah, atau pengujian undang-undang. Topik tidak disalin dari soal ujian
  yang berhak cipta.
- **Rujukan wajib diverifikasi ke sumber primer** lewat perkakas hukum-id pada tanggal yang
  tercatat di setiap butir:
  - status dan pasal: `detail_peraturan` dan `periksa_pasal`;
  - fatwa: `cari_fatwa_dsn`;
  - KHES: `cari_pasal_khes`;
  - ayat, hadis, dan kitab: `ambil_ayat`, `cari_hadis_berderajat`, dan `cari_turats`;
  - metadata putusan: JDIHN.
  Rujukan tidak ditulis dari ingatan.
- **Butir disusun dengan bantuan AI dan belum ditelaah ahli.** Ini keputusan pemilik produk:
  semua diuji otomatis dulu, lalu ahli dari tiap prodi diminta menelaah setelah produk matang.
  Sampai saat itu angka di sini menunjukkan konsistensi mesin terhadap rujukan yang sudah
  diverifikasi, bukan penilaian mutu akademik.
- **Rujukan yang belum bisa diverifikasi ditandai di `verifikasi.catatan`.** Contohnya pasal KHI
  sebelum naskahnya diimpor, atau putusan MK yang teks penuhnya terkunci. Butir semacam ini
  diverifikasi ulang begitu sumbernya tersedia.

## Menjalankan

```bash
# 1. Rekam snapshot sumber (sekali, daring)
HUKUM_CACHE_DIR=eval/snapshot-2026-10 HUKUM_CACHE_BEKU=1 npm run start:api
npm run eval -- --api http://127.0.0.1:3001

# 2. Putaran berikutnya: luring atas snapshot yang sama
HUKUM_CACHE_DIR=eval/snapshot-2026-10 HUKUM_CACHE_BEKU=1 HUKUM_LURING=1 npm run start:api
npm run eval -- --api http://127.0.0.1:3001 --putaran 3

# Dengan AI: isi kunci di lingkungan, jangan di berkas
EVAL_AI_PROVIDER=claude EVAL_AI_MODEL=<id model bertanggal> EVAL_AI_KEY=... npm run eval -- --putaran 3
```

`npm run eval:periksa` memvalidasi semua berkas terhadap skema, menghitung butir per rumpun,
mendaftar rujukan yang belum terverifikasi, dan mencocokkan sidik butir tertahan.

## Metrik

| Metrik | Arti |
|---|---|
| recall | rujukan wajib yang benar-benar dibuka (ada buktinya), dengan interval Wilson 95% |
| status | status berlaku sumber yang ditampilkan sama dengan status terverifikasi |
| jebakan | butir jebakan yang dijawab dengan abstain atau koreksi |
| galat | butir yang gagal diproses (server sibuk, sumber luring tidak ada di snapshot) |

`/v1/ask` belum membuka ayat, hadis, kitab, KHES, KHI, Qanun, maupun putusan. Rujukan jenis itu
sengaja dihitung terlewat, supaya angkanya menjadi garis dasar bagi API v2.

## Pengumpulan alur v2

`npm run eval:v2` hanya preflight lokal, tanpa jaringan atau panggilan AI. Bawaan
satu butir latihan, tiga putaran. Butir tertahan selalu dikeluarkan; tidak ada
opsi untuk membukanya pada kolektor ini. `npm run test:eval-v2` memeriksa tipe dan
menjalankan alur sintetis tanpa biaya.

`eval/v2-flow.ts` menerima hanya pertanyaan/rumpun, lalu menjalankan rencana,
kueri rencana, kandidat telusur, pembukaan sumber, penyaringan, dan sintesis per
bagian. Rujukan wajib tidak diteruskan ke proses penemuan. Tanda tangan, hash,
konteks pertanyaan/bagian dan sumber hasil diverifikasi terhadap kunci yang dipatok.
Kandidat dibatasi 24, bukti tersimpan 120 dan bukti sintesis 24. Pilihan bukti
otomatis ini dicatat sebagai perilaku kolektor, bukan penilaian pengguna manusia.
Kolektor belum memilih pasal lanjutan atau tautan MK seperti pengguna manual;
hal itu dapat menurunkan recall dan harus dihitung sebagai keterbatasan, bukan
ditambal dengan membuka rujukan kunci jawaban.

Pengumpulan berbayar hanya untuk server eval khusus pada loopback, dengan
snapshot beku yang disiapkan operator; jangan memakai secret tiket layanan publik.
Baru setelah budget disetujui pemilik, isi variabel lingkungan `EVAL_AI_PROVIDER`,
`EVAL_AI_MODEL` (ID bertanggal), `EVAL_AI_KEY`, `EVAL_STEP_TICKET_SECRET`,
`EVAL_TICKET_AUDIENCE`, dan `EVAL_PUBLIC_KEY_FILE` (PEM publik). Perintah juga
mensyaratkan `EVAL_CONFIRM_PAID=pasla-eval-v2`, `--run` dan
`--max-paid-steps <batas>`. Contoh bentuk perintah, bukan otorisasi biaya:

```bash
npm run eval:v2 -- --api http://127.0.0.1:3102 --rumpun hes --limit 1 --putaran 3 --max-paid-steps 8 --run
```

Kolektor memeriksa pin sebelum langkah berbayar, menghitung setiap permintaan
berbayar termasuk yang gagal, tidak mencoba ulang otomatis, membatasi input tiket
20.000 token konservatif dan menunggu jendela baru setelah enam langkah akun.
Batas jumlah langkah bukan plafon uang; harga penyedia dan budget tetap harus
diperiksa sebelum menjalankan. Hasil disimpan di `eval/hasil/` yang diabaikan Git.
Kode galat aman dicatat tanpa body/header penyedia atau kredensial.

Hasil **selalu `qualityGatePassed:false`**: ini baru kolektor jejak. Snapshot beku
belum diattestasi lewat API, temperature 0 belum dapat dipaksakan pada API saat
ini, penilaian recall/status/jebakan masih harus dihitung dari jejak sesudah
penemuan, dan penilaian kesetiaan memerlukan penyedia juri independen yang
dikalibrasi terhadap label manusia. Belum ada pengumpulan berbayar melalui
kolektor v2 ini pada checkpoint 18 Oktober; pilot Azure di bawah terpisah.
Preflight dan uji sintetis bukan kelulusan model.

## Pilot integrasi Azure lokal

`npm run eval:azure-pilot` menyediakan preflight tanpa jaringan atau AI.
Pilot terpisah ini memakai core rencana/saring/sintesis secara langsung dengan
satu pertanyaan sintetis dan PERMA 14/2016 Pasal 2 yang **dipilih sebelumnya**.
Ini tidak mengukur penemuan sumber, recall, mutu hukum, akun, API publik atau UI.
`qualityGatePassed` selalu `false`; kolektor v2 di atas tetap memiliki gerbangnya.

Transport dipatok ke `https://pasla.openai.azure.com/openai/v1/chat/completions`,
deployment `pasla-chat`, respons model `gpt-5-mini-2025-08-07`. Identitas hasil
bertanda tangan mencatat Azure/deployment/versi, sementara vendor model OpenAI.
Tidak ada endpoint baru atau kunci platform pada aplikasi/layanan publik.
Skema wire mengikuti subset Azure; batas panjang/jumlah dijelaskan melalui
description dan tetap diperiksa Zod lokal, bukan dianggap dipaksakan Azure.
Diagnosis kegagalan menyimpan kode serta nama bidang yang diizinkan, tanpa
nilai, pesan validasi mentah atau isi respons. `max_completion_tokens`
mencakup token reasoning, tanpa `temperature`.

Pemilik menyetujui **maksimum US$1 untuk pilot awal** pada 18 Oktober 2026.
Jangan menganggap ini otorisasi evaluasi besar atau pengeluaran berulang.
Untuk eksekusi operator, `--run` juga mensyaratkan
`EVAL_CONFIRM_PAID=pasla-azure-pilot-usd1`, `AZURE_OPENAI_API_KEY` sementara dan
`EVAL_PUBLIC_KEY_FILE` berisi **hanya PEM publik Ed25519** yang sudah dipatok.
Jangan menulis/mencetak kunci API, private PEM, respons galat atau header penyedia.

Bawaan tiga putaran, maksimum sembilan percobaan, input konservatif maksimum
20.000 token dan output maksimum 4.096 token per panggilan. Jeda awal panggilan
65 detik, tenggat per panggilan 90 detik, tanpa retry otomatis. Reservasi uang
dihitung **sebelum** jaringan dan dipertahankan pada kegagalan. Pemakaian terukur
yang tersedia dicatat walaupun identitas model/isi respons ditolak.
`--runs 1..3`, `--max-calls 1..9` dan `--max-usd` yang lebih kecil dapat
mempersempit pilot. **Batas ini per proses**: operator wajib mengurangi sisa
budget dan percobaan dari seluruh jejak terdahulu sebelum melanjutkan manual.
Jangan menjalankan dua proses sekaligus di bawah persetujuan US$1 yang sama.

Profil bawaan `core` mempertahankan effort/batas keluaran yang diminta core.
`--profile low-4096` adalah override pilot eksplisit: seluruh langkah memakai
reasoning `low` dan batas keluaran 4.096, termasuk reasoning. Jejak mencatat
profil dan nama model hasil bertanda tangan berakhiran `:low-4096`.
Profil ini bukan pengujian konfigurasi bawaan core/public API.

Sumber diperiksa hash/tanda tangannya sebelum AI dan dibekukan di
`eval/hasil/azure-pilot-*/source.json`. Kelanjutan manual wajib memakai
`--source-file <source.json awal>` agar tidak mengunduh sumber lain; pin/hash/
tanda tangan diperiksa ulang lokal. Signer hasil adalah kunci uji sementara,
hanya PEM publiknya disimpan. Jejak tahap parsial dan batas/pemakaian tetap
disimpan saat berhenti; jangan menghapus hasil gagal dari pelaporan gabungan.

Estimasi memakai tarif tanpa diskon cache US$0,25 input dan US$2 output per satu
juta token dari [publikasi Microsoft](https://devblogs.microsoft.com/foundry/whats-new-in-azure-ai-foundry-august-2025/).
Ini estimasi, bukan tagihan Azure atau pengaturan plafon akun. Cocokkan tagihan
nyata bila tersedia. Rujukan kompatibilitas:
[structured outputs Azure](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs),
[reasoning Azure](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/reasoning),
[API v1](https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle).
