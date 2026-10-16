# Riset v2: checkpoint 16 Oktober 2026

Ini checkpoint implementasi, belum kelulusan evaluasi atau izin rilis produksi.

## Konfigurasi

Node 24.18 atau lebih baru diperlukan untuk SQLite bawaan. `PASLA_SIGNING_KEY` adalah
PKCS#8 Ed25519 (PEM atau base64 PEM). `PASLA_STEP_TICKET_SECRET` harus sama dengan
Functions pratinjau; `PASLA_ENGINE_ORIGIN` harus cocok persis dengan audience tiket.
Tiket wajib secara bawaan. Simpan semua kunci di konfigurasi rahasia, bukan repo.
Kunci publik mesin juga dipatok pada `ENGINE_PUBLIC_KEYS` di Functions.

`HUKUM_CORPUS_PATH` menunjuk SQLite publik, bawaan `.cache/research.sqlite`. Proses
menutup koneksi saat server ditutup. Bangun korpus di PC; jangan mengekstrak PDF massal
pada VPS yang berbagi memori dengan bot pembeli.

## Rute dan batas

- `GET /v2/rumpun`, `POST /v2/telusur`: tanpa AI. Kandidat tetap metadata sampai dibuka.
- `POST /v2/sumber/buka` dan `/v2/sumber/potongan`: paling banyak delapan rujukan.
- `POST /v2/laporan/rencana`, `/saring`, `/sintesis`: BYOK dan tiket langkah, NDJSON,
  tenggat 80 detik, output 2.500 atau 4.096 token. Pembatalan tidak menjamin bebas tagihan.
- `POST /v2/sumber/unggahan`: hanya `{fileHash}`. Kecocokan hash tidak mengesahkan teks klien.

PDF mesin: 16 MiB, 600 halaman, empat juta karakter, 45 detik dan heap worker 96 MiB.
Korpus parsial atau lapisan teks rusak tidak dapat membuktikan pasal tidak ada. Absensi
hanya dapat dinyatakan pada impor lengkap dengan pemeriksaan ekstraksi yang sesuai.

## Bukti saat checkpoint

`npm run verify` lulus: lint, OpenAPI, 119 uji TypeScript beserta uji fondasi/parser,
typecheck, build, smoke PDF dari dist, dan build web bawaan. `eval:periksa` menjaga hash
35 soal tertahan. Itu validasi dataset, bukan hasil evaluasi model.

PERMA 14/2016 berhasil diimpor dari salinan PDF JDIH BPK: 11 halaman, 16 potongan,
SHA-256 `5592fa9022db9dd4ca0a1aa28c2579c3feec4a1e34ceaff8e150dea746b4ed70`.
Impor tetap parsial sampai kelengkapan naskah diaudit. Berkas dan indeks diabaikan Git.

Sumber: [detail PERMA](https://peraturan.bpk.go.id/Details/209692/perma-no-14-tahun-2016),
[PDF resmi](https://peraturan.bpk.go.id/Download/203788/Perma%20Nomor%2014%20Tahun%202016.pdf).

## Pekerjaan tersisa

Naskah resmi KHI belum diperoleh: BPHN memberi tantangan akses dan tidak ditembus.
Peta madzhab, salinan putusan, konsolidasi Qanun dan cakupan korpus belum lengkap.
Helper PDF uji materi BPK belum diekspos sebagai rujukan API. Evaluasi model berbayar,
kalibrasi pemilik, uji beban 450 MiB, deployment pratinjau dan persetujuan produksi
belum selesai. Semua rumpun tetap berlabel cakupan terbatas.
