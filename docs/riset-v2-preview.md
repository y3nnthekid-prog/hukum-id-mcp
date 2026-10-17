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

`npm run verify` terbaru (18 Oktober) lulus: lint, OpenAPI, 129 uji TypeScript beserta uji fondasi/parser,
typecheck, build, smoke PDF dari dist, dan build web bawaan. `eval:periksa` menjaga hash
35 soal tertahan. Itu validasi dataset, bukan hasil evaluasi model.

PERMA 14/2016 berhasil diimpor dari salinan PDF JDIH BPK: 11 halaman, 16 potongan,
SHA-256 `5592fa9022db9dd4ca0a1aa28c2579c3feec4a1e34ceaff8e150dea746b4ed70`.
Impor tetap parsial sampai kelengkapan naskah diaudit. Berkas dan indeks diabaikan Git.

Tambahan korpus JDIH Aceh (snapshot, bukan konsolidasi):

| Naskah | Potongan | SHA-256 | Batas |
|---|---:|---|---|
| Qanun 7/2013, Hukum Acara Jinayat | 586 | `ae2566d91ba11f528d7ab2caf8357f4114f42ed9af939956d9be29b714236084` | 112 halaman; kelengkapan belum diaudit |
| Qanun 6/2014, Hukum Jinayat | 152 | `3b2b44006b625b7454f735322a8eb466238ac5dd40a8202f427b2bfa08a8dc71` | Naskah asli; berstatus Diubah oleh Qanun 12/2025 |
| Qanun 12/2025, perubahan Qanun 6/2014 | 27 | `896d4db4e012bbf392a0545a1c3f919a52d932077cb5017e4a45af4dc786c326` | Teks terbaca halaman 1–14; halaman 15–20 memerlukan OCR/pemeriksaan |

Relasi perubahan pada manifest dipertahankan dalam metadata dan tanda tangan
potongan. Naskah asli tidak ditulis ulang menjadi teks konsolidasi. Semua impor
ini `complete:false`, sehingga pasal yang tidak terbaca tidak membuktikan ketiadaan.
Sumber primer: [7/2013](https://jdih.acehprov.go.id/dih/detail/fe938c25-dc87-4d28-a6aa-1df884784289),
[6/2014](https://jdih.acehprov.go.id/dih/detail/8728e682-3306-42d5-a307-64bb638859c7),
[12/2025](https://jdih.acehprov.go.id/dih/detail/630e9ae4-952f-4116-94fe-071d2c7184b4).

Parser kini dipatok ke pdfjs-dist 6.4.299. `pdf-profile.json` dan penyusun baris
identik dengan web; build menolak versi/hash/profil yang berbeda. Cache juga
mengikat profil dan batas sumber daya. Input buffer tidak memakai cache URL.
Worker yang keluar sebelum mengirim hasil ditolak, dan proses dist memuat modul
penyusun baris hasil build. Nomor pasal OCR berspasi dinormalisasi hanya pada
locator; teks sumber tetap dipertahankan.

Sumber: [detail PERMA](https://peraturan.bpk.go.id/Details/209692/perma-no-14-tahun-2016),
[PDF resmi](https://peraturan.bpk.go.id/Download/203788/Perma%20Nomor%2014%20Tahun%202016.pdf).

## Pekerjaan tersisa

Naskah resmi KHI belum diperoleh: BPHN memberi tantangan akses dan tidak ditembus.
Peta madzhab, salinan putusan, konsolidasi Qanun dan cakupan korpus belum lengkap.
Helper PDF uji materi BPK belum diekspos sebagai rujukan API. Evaluasi model berbayar,
kalibrasi pemilik, uji beban campuran 450 MiB dan persetujuan produksi belum selesai.
Preview v2 sudah berjalan terpisah di port 3102; v1 tetap di 3101. Pembaruan parser
dan korpus di atas harus dipasang sebagai rilis v2 terisolasi sebelum dianggap
tersedia lewat HTTPS. Semua rumpun tetap berlabel cakupan terbatas.
