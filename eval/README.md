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
