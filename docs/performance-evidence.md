# Bukti kinerja kandidat 0.7.0

Dokumen ini mencatat hasil ukur yang dapat direproduksi. Angka di sini bukan perkiraan dan
bukan pengganti pengukuran staging Azure.

## Pencarian cache — 50 pengguna serentak

- Tanggal: 6 September 2026.
- Perintah: `npm run test:load`.
- Lingkungan: Node.js 24.18.0, npm 11.16.0, Windows 10.0.26200, 4 logical processor.
- Target: 50 permintaan serentak, error `<1%`, median p95 pencarian `<=500 ms`, dan
  median p95 exact lookup `<=300 ms`.
- Dataset: `CHANNEL_FIXTURE_RELEASE=fixture-release-2026-09-06`, seluruhnya berada di memori.
- Isolasi: test mengganti `globalThis.fetch` dengan pagar yang hanya menerima
  `127.0.0.1`; permintaan ke host lain langsung gagal.

Metode memakai satu warm-up lalu tiga gelombang terpisah berisi 50 permintaan serentak.
Gate memakai median dari tiga nilai p95 agar satu lonjakan scheduler tidak menyamar sebagai
kinerja normal maupun kegagalan normal.

Hasil eksekusi bersih:

| Metrik | Pencarian cache | Exact lookup REST |
|---|---:|---:|
| Concurrency per gelombang | 50 | 50 |
| Total request | 150 | 150 |
| Error | 0 (0%) | 0 (0%) |
| p95 per gelombang | 130,32 / 65,57 / 36,62 ms | 63,16 / 43,03 / 58,77 ms |
| Median p95 | 65,57 ms | 58,77 ms |
| Maksimum | 131,45 ms | 66,56 ms |
| Permintaan eksternal | 0 | 0 |

Kesimpulan: gate beban lokal berbasis fixture lulus. Angka ini mengukur overhead HTTP,
middleware keamanan, rate-limit, serialisasi, dan core fixture pada satu mesin. Ia tidak
mengukur cold start Container Apps, unduhan index, latensi Azure Storage, atau connector
live; metrik tersebut tetap harus dibuktikan di staging sebelum klaim production-ready.

### Percobaan yang tidak dipakai sebagai angka gate

Exact lookup lewat remote MCP stateless sempat diukur pada 50 panggilan bersamaan:
`p95 470,99 ms`, melewati target 300 ms. Profil menunjukkan biaya dominan berasal dari
pembuatan transport dan registrasi sepuluh tool untuk setiap request stateless, bukan dari
lookup evidence. Jalur itu tetap benar secara kontrak, tetapi angka gate exact lookup memakai
endpoint REST ringan `GET /v1/documents/{id}/articles/{article}` yang memanggil core yang sama.
Baseline gagal ini dipertahankan agar optimasi remote MCP berikutnya mempunyai pembanding.

## Web Core Web Vitals

Belum diisi. LCP dan INP hanya akan dicatat setelah build production diukur dengan profil
seluler menengah dan interaksi nyata.
