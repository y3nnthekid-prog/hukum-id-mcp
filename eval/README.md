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
dikalibrasi terhadap label manusia. Tidak ada pengumpulan berbayar dijalankan
pada checkpoint 18 Oktober. Preflight dan uji sintetis bukan kelulusan model.
