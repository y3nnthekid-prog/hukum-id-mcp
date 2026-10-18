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

`npm run verify` terbaru (18 Oktober) lulus: lint, OpenAPI, 131 uji TypeScript beserta uji fondasi/parser,
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
Rujukan API `putusan-mk-bpk` menerima nomor perkara, URL resmi DownloadUjiMateri
berbentuk ID/nama.pdf, dan halaman opsional 1–600. Kepala putusan diperiksa pada
awal dokumen, bukan kemunculan nomor dalam pembahasan; spasi OCR dinormalisasi
hanya untuk identitas. Teks asli tetap ditandatangani. Contoh unduhan resmi
`https://peraturan.bpk.go.id/DownloadUjiMateri/42/33_PUU-XIV_2016.pdf` berhasil
dibuka sebagai 33/PUU-XIV/2016. Bawaan hanya delapan halaman awal, bukan seluruh
putusan. Rilis `ac1bfba` sudah aktif pada 18 Oktober: empat sumber korpus dan
putusan 33/PUU-XIV/2016 halaman 25 dibuka serta diverifikasi terhadap kunci yang
dipatok sebelum aktivasi diterima. Rilis/korpus `8dd6367` dipertahankan untuk rollback.

Evaluasi model berbayar, kalibrasi pemilik dan persetujuan produksi belum selesai.
Preview v2 sudah berjalan terpisah di port 3102; v1 tetap di 3101. Rilis `8dd6367`
beserta korpus di atas telah dipasang pada 18 Oktober. Empat sumber dibuka dan
diverifikasi dengan kunci publik yang dipatok sebelum aktivasi dianggap berhasil;
PID v1 tidak berubah. Rilis/korpus sebelumnya dipertahankan. Uji PDF Linux dari
dist juga lulus. Uji campuran terpisah pada rilis `ac1bfba` kemudian lulus dalam
cgroup MemoryMax 450 MiB, MemorySwapMax 0 dan CPUQuota 50%: tiga gelombang masing-
masing dua ekstraksi PDF 112 halaman tanpa cache dan delapan sintesis sintetis
dengan delay dua detik. Seluruh 30 permintaan selesai, nol galat/panggilan AI
berbayar/egress; maksimum dua PDF dan delapan AI dengan overlap teramati. PDF
memerlukan sekitar 14,3–17,0 detik. Ini uji kapasitas dengan provider sintetis,
bukan latensi atau mutu provider nyata, dan sintesis memakai bukti sintetis
terpisah dari isi PDF. PID v1/v2 tetap sama dan NRestarts nol sesudah uji.
Uji HTTPS 3×10 pembukaan sumber tanpa AI memberi p95 552,14 / 319,94 / 307,56 ms
dan nol galat; gerbang 500 ms belum lulus pada seluruh gelombang.
Semua rumpun tetap berlabel cakupan terbatas.

Kolektor `npm run eval:v2` kini menyediakan preflight tanpa jaringan/biaya dan
alur v2 teruji sintetis; rujukan kunci jawaban tidak dikirim ke penemuan sumber.
Jejak tetap menandai gerbang mutu belum lulus. Lihat `eval/README.md` untuk batas
snapshot, temperature, juri, label manusia dan otorisasi biaya.

Kandidat KHI dari perpustakaan resmi MA (katalog id 2913, lampiran fid 3858)
berhasil diunduh, tetapi hanya enam halaman pindai pengantar/daftar isi, tanpa
lapisan teks maupun batang Buku I–III. Pemeriksaan visual menegaskan lampiran
parsial; berkas ini tidak diimpor sebagai naskah KHI lengkap.

Kandidat lain dari situs Kelurahan Pilangbango Madiun adalah salinan ulang 2001,
35 halaman dengan Buku I/II/III pada halaman 1/24/30. Pemeriksaan gambar halaman
16 dan 18 menegaskan Pasal 124 dan 139 tidak ada pada PDF, meskipun kesehatan
lapisan teks berstatus ok. Naskah ini tidak diimpor. Hash SHA-256:
`3f884f63ae069cde40e325ee6c5c0f966a0423489e4d17ea23b06dafca7022cb`.

Importer lokal kini memeriksa urutan 1–229, teks isi pasal, batas Buku I/II/III
pada pasal 1/171/215, serta memisahkan penjelasan sebelum pemeriksaan cakupan.
Naskah dengan penanda daftar isi memerlukan kurasi manual. Audit struktur ini
tidak mengesahkan transkripsi atau status hukum terkini. Penolakan PDF nyata
diuji dengan indeks memori kosong; tidak ada baris yang ditulis. Perubahan hanya
alat impor lokal; layanan VPS aktif tetap `ac1bfba` dan korpus empat sumber.

[Kandidat yang ditolak](https://kelurahan-pilangbango.madiunkota.go.id/wp-content/uploads/2022/02/Kompilasi-Hukum-Islam.pdf).
