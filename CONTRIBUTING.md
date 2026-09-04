# Panduan Kontribusi

Terima kasih sudah berminat ikut membangun. Proyek ini dipakai untuk pekerjaan yang
konsekuensinya nyata — tulisan akademik, analisis kepatuhan, dan kadang perkara — jadi
panduan ini lebih banyak bicara soal kejujuran keluaran daripada soal gaya kode.

## Empat prinsip yang mengikat semua sumbangan

**1. Tidak ada klaim tanpa dokumen.** Setiap tool mengembalikan sumber dan tautan. Tidak
boleh ada keluaran yang bergantung pada pengetahuan model.

**2. Kegagalan tidak boleh menyamar sebagai temuan negatif.** Ini yang paling sering
dilanggar tanpa sadar. Bila pencarian gagal dijalankan, keluarannya harus mengatakan
"gagal", bukan mengembalikan daftar kosong yang akan dibaca sebagai "tidak ada".

Contoh nyata di proyek ini: `periksa_pasal` memberi peringatan eksplisit ketika
silang-periksa ke MK tidak berhasil dijalankan, supaya `putusan_mk_terkait` yang kosong
tidak disalahartikan sebagai "tidak ada perkara".

**3. Beban situs sumber ditekan, bukan dibiarkan tumbuh.** Cache dulu, jaringan belakangan.

**4. Yang tidak ditemukan dinyatakan tidak ditemukan**, lengkap dengan apa saja yang sudah
dicoba. Lihat `src/khes.js` sebagai contoh: naskah KHES belum ditemukan, dan tool menolak
dengan jelas alih-alih menebak nomor pasal.

## Yang tidak akan diterima

- Penjelajahan massal atau pengunduhan seluruh basis data.
- Kode untuk melewati CAPTCHA atau pembatasan akses lainnya.
- Pengumpulan untuk melatih model. Situs sumber memberi sinyal `ai-train=no`, dan itu
  dihormati.
- Menaikkan kecepatan dengan menghapus jeda antarpermintaan.
- Melonggarkan uji agar lulus, ketika yang seharusnya diperbaiki adalah parsernya.

## Menyiapkan lingkungan

```bash
npm install
npm run test:parser  # cukup ini untuk kerja sehari-hari; tanpa jaringan
npm test             # seluruh uji deterministik: parser, fondasi, kontrak, TypeScript
npm run verify       # gerbang yang sama dengan CI: lint, uji, typecheck, build
npm run smoke        # uji asap end-to-end; MENEMBAK situs sumber sungguhan
```

Butuh Node.js 22 ke atas dan `curl` pada PATH.

`npm test` sengaja tidak memanggil `npm run smoke`. Uji asap menembak situs lembaga negara,
sehingga menjalankannya pada tiap perubahan akan membebani server yang dibiayai anggaran
publik. Ia dijalankan oleh canary terjadwal seminggu sekali, atau manual saat memang perlu.

Perubahan perilaku core wajib menambah uji TypeScript dan lulus `npm run verify`. Perubahan
REST juga wajib menjaga [openapi.yaml](openapi.yaml) sinkron; keputusan lintas-kanal atau
penyimpanan dicatat sebagai ADR di `docs/decisions/`.

## Menambah sumber baru

Ikuti pola modul yang sudah ada — `src/perma.js` adalah contoh terkecil dan paling mudah
ditiru.

1. **Buat modul di `src/`.** Pakai ulang perkakas yang sudah ada, jangan menulis sendiri:
   - `getText`, `getBuffer`, `getJson` dari `src/http.js` — sudah membawa header ala
     browser, jeda sopan per host, retry, cadangan `curl`, cache, dan pemutus arus.
   - `toText`, `inline`, `decodeEntities` dari `src/http.js` untuk membersihkan HTML.
   - `halamanPdf`, `ekstrakTeksPdf`, `cariDalamPdf` dari `src/pdf.js` untuk PDF.
   - `ambilJson`, `simpanJson` dari `src/cache.js` bila perlu indeks yang disimpan.

2. **Pisahkan parser sebagai fungsi yang diekspor.** Ini syarat agar bisa diuji tanpa
   jaringan. Contoh: `parseDaftar` di `src/ma.js`, `parseTabelProduk` di `src/dsn.js`.

3. **Simpan fixture.** Ambil satu salinan HTML nyata dari sumber itu, taruh di
   `test/fixtures/`, lalu tambahkan pemeriksaan di `test/parser.test.js`. Uji harus memeriksa
   **bentuk hasilnya**, bukan sekadar bahwa fungsi tidak melempar galat.

4. **Daftarkan tool di `src/server.js`.** Bungkus dengan `bungkus()` agar galat menjadi
   keluaran yang terbaca, bukan lemparan mentah.

5. **Tulis deskripsi tool yang jujur.** Deskripsi adalah tempat batas dan jebakan
   diberitahukan. Sebutkan apa yang tidak bisa dilakukan tool itu, bukan hanya apa yang bisa.

6. **Tambahkan probe di `src/kesehatan.js`** dengan kueri yang hasilnya sudah diketahui,
   supaya kerusakan senyap pada sumber itu ikut terdeteksi.

## Ketika situs sumber berganti tampilan

Ini akan terjadi, dan bukan salah siapa pun. Urutan penanganannya:

1. Jalankan `npm run test:parser`. Bila lulus, kode belum berubah — berarti situsnya yang
   berubah.
2. Jalankan tool `periksa_kesehatan_sumber`. Status `berubah_struktur` memastikannya.
3. Ambil salinan HTML terbaru, **ganti fixture-nya secara sadar**, dan catat di pesan commit
   bahwa fixture diperbarui karena situs sumber berubah.
4. Perbaiki parsernya sampai uji lulus terhadap fixture baru.

Jangan pernah melonggarkan uji agar lulus tanpa memperbarui fixture. Uji yang dilonggarkan
akan diam ketika kerusakan berikutnya datang.

## Menulis uji

Uji di proyek ini sengaja ditulis sederhana, tanpa kerangka kerja: fungsi `ok(label, syarat,
keterangan)` yang mencetak PASS atau FAIL. Keterangan diisi bukti nyata — nomor peraturan
yang terbaca, jumlah hasil, status yang ditemukan — agar kegagalan langsung memberi tahu apa
yang salah tanpa perlu membuka kode.

Uji yang baik di sini memeriksa hal yang pernah rusak. Beberapa contoh yang ada sekarang
lahir dari bug sungguhan: pencocokan nomor perkara MK yang tertukar karena substring,
pencarian hadis yang mencocokkan "riba" di dalam "beribadah", dan pagination BPK yang selalu
terbaca satu halaman padahal 3.560.

## Bahasa

Kode, komentar, deskripsi tool, dan dokumentasi ditulis dalam **bahasa Indonesia**. Alasannya
bukan sentimen: pengguna utamanya peneliti hukum Indonesia, dan istilah hukum Indonesia tidak
punya padanan yang tepat dalam bahasa Inggris. Nama variabel pun memakai istilah yang dikenal
di bidangnya — `peraturan`, `putusan`, `fatwa`, `relasi_status` — supaya kode terbaca oleh
orang yang paham hukum meski tidak biasa membaca kode.

Ringkasan berbahasa Inggris disediakan di README untuk pembaca internasional.

## Commit dan pull request

- Pesan commit menjelaskan **mengapa**, bukan hanya apa. Bila memperbaiki bug, sebutkan
  gejalanya dan bagaimana ia bisa luput.
- Sertakan hasil `npm test` pada deskripsi pull request.
- Perubahan yang menyentuh perilaku keluaran tool harus disertai pembaruan `CHANGELOG.md`.
- Bila menambah atau mengubah batas kemampuan, perbarui juga skill terkait di
  `~/.claude/skills/` bila relevan, karena di sanalah metode pemakaiannya diatur.

## Batas tanggung jawab

Perangkat ini bukan nasihat hukum dan bukan fatwa. Kontribusi yang membuat keluarannya
terdengar seperti keduanya — misalnya menghapus penegasan batas, atau membuat tool
memutuskan sendiri hal yang menuntut penilaian ahli — tidak akan diterima.
