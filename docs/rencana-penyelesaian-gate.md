# Rencana Penyelesaian Quality Gate

Dokumen ini ditujukan kepada sesi AI berikutnya. Ia dirancang **berdiri sendiri**: tidak
mengandaikan kau ikut percakapan sebelumnya. Baca seluruhnya sebelum menyentuh kode.

Sasarannya menutup gerbang di [launch-readiness.md](launch-readiness.md) yang **bisa
diselesaikan tanpa bergantung pada pihak lain**. Gerbang yang menuntut ahli manusia atau
langganan Azure aktif sengaja ditinggalkan, dan dinyatakan di bagian akhir.

---

## Keadaan saat memulai

Per 5 September 2026, versi 0.6.0, sudah terbit di
[npm](https://www.npmjs.com/package/hukum-id-mcp) dan
[GitHub](https://github.com/y3nnthekid-prog/hukum-id-mcp).

Dua gerbang yang harus tetap hijau sepanjang pekerjaan:

```bash
npm run verify   # lint, uji deterministik, tsc strict, build API + Web
npm run smoke    # 59 pemeriksaan ke sumber sungguhan — JANGAN dijalankan tiap perubahan
```

`npm run smoke` menembak situs lembaga negara. Jalankan **seperlunya saja**, idealnya sekali
di akhir. Gerbang harian adalah `npm run verify`.

---

## Empat aturan yang mengikat, tanpa kecuali

Diambil dari `CONTRIBUTING.md`. Melanggarnya membatalkan nilai seluruh pekerjaan.

1. **Tidak ada klaim tanpa dokumen.** Tiap keluaran membawa sumber dan tautan.
2. **Kegagalan tidak boleh menyamar sebagai temuan negatif.** Pencarian yang gagal
   dijalankan harus berkata "gagal", bukan mengembalikan daftar kosong yang akan dibaca
   sebagai "tidak ada".
3. **Beban situs sumber ditekan.** Cache dulu, jaringan belakangan.
4. **Yang tidak ditemukan dinyatakan tidak ditemukan**, lengkap dengan apa yang sudah dicoba.

### Yang akan ditolak

- **Melonggarkan uji agar lulus.** Bila uji gagal, perbaiki kodenya. Bila situs sumber yang
  berubah, perbarui fixture-nya **secara sadar** dan catat di pesan commit.
- **Menembus CAPTCHA atau pembatasan akses.** Ini garis etis, bukan tantangan teknis.
- **Menghapus penegasan batas** ("bukan nasihat hukum, bukan fatwa") atau membuat tool
  memutuskan sendiri hal yang menuntut penilaian ahli.
- **Uji beban yang menembak situs pemerintah.** Lihat Tugas 6.

---

## Catatan kebersihan git

Repositori ini kadang dikerjakan dari sesi lain secara bersamaan (cabang `codex/*`).
Sebelum menyunting, jalankan `git status` dan periksa waktu ubah berkas. Commit dalam
potongan kecil per tugas, jangan satu commit raksasa.

---

## Tugas, berurutan menurut nilai

Kerjakan berurutan. Tiap tugas punya **kriteria lulus** yang harus dibuktikan, bukan
diyakini.

---

### Tugas 1 — Uji SSRF lengkap (paling penting)

**Kenapa lebih dulu:** ini gerbang keamanan. Tool menerima URL dari argumen, sehingga
instruksi yang diselipkan di dalam dokumen yang sedang dibaca bisa meminta model mengambil
alamat internal. Dampak kebocoran paling besar, dan tidak bergantung siapa pun.

**Yang sudah tertutup** di `test/trust-foundation.test.js`: alamat IPv4-mapped, penolakan
saat salah satu jawaban DNS privat, dan penerimaan alamat publik lewat DNS64.

**Yang masih terbuka — kerjakan semuanya:**

| Serangan | Yang harus dibuktikan |
|---|---|
| IPv6 privat literal | `::1`, `fc00::/7` (unique local), `fe80::/10` (link-local) ditolak |
| DNS rebinding | Jawaban DNS publik pada panggilan pertama lalu privat pada panggilan kedua tetap ditolak — validasi harus terjadi **sebelum tiap permintaan**, bukan sekali di awal |
| Redirect | Server menjawab 302 ke `http://169.254.169.254/` (metadata cloud) harus ditolak — **tiap hop divalidasi**, bukan hanya URL awal |
| Response bomb | Balasan yang menyatakan `Content-Length` raksasa, dan aliran yang terus mengirim tanpa henti, harus dipotong pada batas yang wajar |
| Path traversal | `impor_khes({ path_pdf })` menerima jalur lokal — uji `../../`, jalur absolut ke luar direktori kerja, dan varian ter-URL-encode |
| Prompt injection | Dokumen yang memuat "abaikan instruksi sebelumnya" harus kembali sebagai **data**, ditandai tidak tepercaya, tidak pernah sebagai instruksi |
| Akses horizontal | Pengguna A tidak dapat membaca unggahan pengguna B |

**Berkas yang disentuh:** `src/trust.js` (`assertPublicUrl`), `src/http.js` (redirect dan
batas ukuran), `src/khes.js` (validasi jalur), `src/storage/uploads.ts` dan `src/auth.ts`
(akses horizontal), `test/trust-foundation.test.js` (uji).

**Petunjuk penting:** periksa dulu apakah `src/http.js` mengikuti redirect secara otomatis
dan apakah ia memvalidasi ulang tiap hop. Bila `fetch` mengikuti redirect sendiri tanpa
divalidasi, itu lubang nyata — setel `redirect: "manual"` lalu validasi tiap `Location`.

Ingat juga jalur `curl`: `CURL_ONLY` memakai proses anak untuk
`putusan3.mahkamahagung.go.id`. Pastikan jalur itu **tidak** melewati pagar — beri
`--max-redirs 0` atau validasi setara.

**Kriteria lulus:**
- Tiap baris tabel di atas punya minimal satu uji yang **gagal bila pagarnya dilepas**.
  Buktikan: lepas sementara satu pagar, pastikan ujinya merah, lalu pasang kembali.
- `npm run verify` hijau.
- Tidak ada uji lama yang dilonggarkan.

---

### Tugas 2 — Fixture PDF yang sulit

**Kenapa:** parser PDF adalah tempat kerusakan paling mungkin terjadi diam-diam — tool tetap
menjawab, isinya kosong atau keliru.

Buat PDF uji kecil di `test/fixtures/pdf/`, lalu uji di `test/parser.test.js`:

| Kasus | Perilaku yang benar |
|---|---|
| PDF hasil scan tanpa lapisan teks | Menyatakan "tidak ada lapisan teks", **bukan** berhasil dengan isi kosong |
| Tata letak dua kolom | Urutan baca benar, kolom tidak tercampur |
| Halaman kosong di tengah | Dilewati tanpa menggeser penomoran halaman |
| Teks Arab font non-Unicode | Memberi peringatan bahwa teksnya tidak dapat dipercaya |
| Tanggal mustahil dari PDF | 31 Februari ditolak, bukan digeser diam-diam ke 3 Maret |

Kasus terakhir sudah ditangani `parseLegalDate` di `src/trust.js`; yang perlu ditambahkan
adalah jalur ketika tanggalnya datang dari isi PDF.

**Kriteria lulus:** kelima kasus punya fixture nyata dan uji yang memeriksa **bentuk
hasilnya**, bukan sekadar bahwa fungsi tidak melempar galat. `npm run test:parser` hijau
tanpa jaringan.

---

### Tugas 3 — Exact lookup: 100% abstain

**Kenapa:** inilah inti janji alat ini. Menebak kandidat pertama lebih buruk daripada tidak
menjawab.

Buat `test/abstain.test.js` berisi minimal 40 rujukan yang **dipastikan tidak ada**:

- Peraturan: `UU 999/2099`, `PP 888/2098`, `Perpres 777/2097`
- Pasal di luar rentang: `Pasal 9999` pada peraturan yang benar-benar ada
- Putusan MK: `999/PUU-XXX/2099`
- Fatwa: `999/DSN-MUI/XII/2099`
- Rujukan ambigu: nomor dan tahun yang bertabrakan antar-jenis

Semua wajib dijalankan **tanpa jaringan**, dengan menyemai cache memakai fixture — pola ini
sudah dipakai di `test/parser.test.js` lewat `simpan(url, Buffer)`.

**Kriteria lulus:**
- Nol kandidat salah. Tidak satu pun rujukan palsu menghasilkan `matched`.
- Tiap abstain menyertakan **alasan** dan **apa yang sudah dicoba**.
- Uji ambigu memastikan `jenis` mempersempit tanpa pernah mengubah `ambiguous` menjadi
  `not_found` yang keliru — perilaku ini ada di `selectExactCandidate` pada `src/trust.js`.

---

### Tugas 4 — Nol kutipan fiktif

Tiap proposisi pada `ResearchResult` wajib membawa evidence yang benar-benar dapat dibuka
dan memuat teks yang diklaim.

**Kriteria lulus:** uji yang menyuntikkan klaim tanpa evidence sah, lalu memastikan klaim itu
**dibuang** dan hasilnya abstain — bukan diloloskan dengan catatan kecil. Perluas
`test/ai-synthesis.test.ts`.

---

### Tugas 5 — Kontrak lintas kanal

Kueri yang sama lewat REST API, MCP `stdio`, dan remote MCP harus mengembalikan **evidence id
yang sama** untuk rilis korpus yang sama.

**Kriteria lulus:** satu uji yang menjalankan ketiga kanal atas satu rilis dan membandingkan
evidence id-nya. Perluas `test/mcp-contract.test.ts` dan `test/remote-mcp.test.ts`.

---

### Tugas 6 — Uji beban 50 pengguna serentak

**PERINGATAN ETIS — baca sebelum menulis kode.** Uji beban ini **tidak boleh** menembak
situs pemerintah. Membebani server yang dibiayai anggaran publik demi angka p95 kita adalah
pelanggaran langsung atas bagian Etika Pemakaian pada README.

Jalankan terhadap **cache yang sudah terisi atau fixture**, dengan jaringan keluar dimatikan.
Isi cache lebih dulu dengan `npm run snapshot`.

**Kriteria lulus:** 50 permintaan serentak, tingkat galat di bawah 1%, p95 tercatat dan
didokumentasikan. Sertakan bukti bahwa tidak ada permintaan keluar selama pengujian.

---

### Tugas 7 — Web LCP dan INP

Ukur `web/` yang sudah dibangun pada profil seluler menengah. Sasaran: LCP ≤ 2,5 detik,
INP ≤ 200 ms.

**Kriteria lulus:** angka hasil pengukuran dicatat di `docs/`, bukan diperkirakan.

---

## Setelah semua tugas selesai

1. `npm run verify` — wajib hijau.
2. `npm run smoke` — sekali saja, di akhir. Harus 59 lulus, 0 gagal.
3. Perbarui kotak centang di [launch-readiness.md](launch-readiness.md) **hanya untuk
   gerbang yang benar-benar punya bukti**. Jangan mencentang yang belum diuji.
4. Perbarui `CHANGELOG.md`.
5. Naikkan versi ke 0.7.0, tag, dan terbitkan.

**Jangan menyebut perangkat ini production-ready** selama masih ada gerbang tanpa bukti —
termasuk gerbang yang memang tidak bisa kita tutup sendiri.

---

## Yang sengaja TIDAK ada di rencana ini

Bukan karena terlupa, melainkan karena bukan pekerjaan yang bisa diselesaikan model AI
sendirian:

| Gerbang | Kenapa butuh pihak lain |
|---|---|
| 300 query golden-set ditinjau ahli | Bila AI menilai jawabannya sendiri benar, itu bukan pengujian melainkan lingkaran. Butuh ahli hukum nasional dan ahli HES. |
| Recall top-5 ≥95%, locator ≥99% | Bergantung pada golden-set di atas. |
| Canary dan rollback diuji di staging | Butuh langganan Azure yang aktif beserta kredensialnya. |
| Alert latency, error, biaya, deletion | Sama — butuh Azure Monitor yang hidup. |

Dan dua hal yang **tidak boleh** diselesaikan sama sekali:

- **CAPTCHA Direktori Putusan MA.** Jalan memutar yang sah sudah ada: telusur kategori dan
  WebSearch `site:putusan3.mahkamahagung.go.id`, lalu diverifikasi lewat `detail_putusan_ma`.
- **Teks Arab rusak pada PDF fatwa DSN.** Kerusakan ada di sumbernya, karena font
  non-Unicode. Sudah diakali dengan mengambil dalil dari sumber terpisah — ayat lewat
  `ambil_ayat`, hadis lewat `hadis_berderajat` yang membawa derajat kesahihan. **Jangan
  menambahkan OCR Arab**: OCR yang salah pada teks dalil lebih berbahaya daripada teks yang
  jelas-jelas rusak, sebab kerusakan terlihat sedangkan salah baca tidak.

---

## Cara melapor

Pada akhir pekerjaan, tulis ringkasan yang memuat:

- Gerbang mana yang ditutup, beserta **bukti**: nama uji dan hasil yang terukur.
- Cacat yang ditemukan di sepanjang jalan, dan bagaimana ia bisa luput selama ini.
- Apa yang **tidak** berhasil dikerjakan, dan alasannya.

Laporan yang menyebut sesuatu "sudah beres" tanpa angka atau nama uji tidak dapat diperiksa,
dan karena itu tidak dihitung.
