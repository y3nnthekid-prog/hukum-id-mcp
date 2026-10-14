# Catatan Perubahan

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/), versi mengikuti
[Semantic Versioning](https://semver.org/lang/id/). Peneliti disarankan menyebutkan versi
alat ini dalam tulisannya demi reproduktibilitas.

## [0.8.1] - 2026-10-14

### Keamanan

- CI menolak rilis 0.8.0 karena advisori yang terbit sesudah 0.7.0: Next.js (critical, antara
  lain RCE di `next/og` dan SSRF di optimasi gambar), `proxy-addr` (critical, lewat Express di
  SDK MCP), serta `@grpc/grpc-js`, `@modelcontextprotocol/sdk`, `sharp`, dan `source-map-js`
  (high). Web dinaikkan ke Next.js 16.4.0 dan dependensi lain diperbarui tanpa versi mayor.
  `npm audit` kini nol, termasuk dependensi dev.
- Catatan proses: `npm audit fix --omit=dev` ikut mencopot devDependencies dari `node_modules`
  sehingga `npm run verify` gagal dengan "eslint is not recognized". Pasang ulang penuh sebelum
  verify.

## [0.8.0] - 2026-10-14

Dibuat untuk pilot Pasla (pasla.tech): satu server di belakang Cloudflare Tunnel, tanpa
akun, tanpa unggahan.

### Ditambahkan

- `POST /v1/ask`: menjawab pertanyaan bahasa sehari-hari dari kutipan resmi. AI hanya
  merencanakan rujukan yang perlu diperiksa, lalu server membukanya sendiri lewat exact
  lookup yang gagal tertutup. Rujukan karangan AI berakhir sebagai "tidak ditemukan", bukan
  bukti palsu. Respons memuat kartu sumber berikut status berlaku, relasi perubahan dan
  pencabutan, langkah yang dicoba, serta kandidat yang belum dibuka.
- AI multi-penyedia dengan BYOK per permintaan: Claude (`@anthropic-ai/sdk`, keluaran
  terstruktur, fallback server-side untuk model yang mendukungnya, bawaan `claude-opus-5-5`),
  Gemini, dan penyedia kompatibel OpenAI dari daftar tetap (OpenAI, OpenRouter, Groq,
  DeepSeek, Mistral). Alamat penyedia kustom sengaja tidak diterima.
- Kuota harian untuk kunci AI platform per klien; BYOK tidak dikenai kuota AI.
- Gerbang konkurensi `/v1/ask` yang menjawab "sedang ramai" alih-alih menumpuk permintaan ke
  situs sumber.
- Mode `HUKUM_MODE=pilot-vm`: bind ke localhost, tanpa Entra dan Azure Storage, MCP remote
  dimatikan kecuali token bearer disetel, IP klien dibaca dari `CF-Connecting-IP`.
- `HUKUM_USER_AGENT` untuk server yang ingin mengenalkan dirinya dengan jujur.

### Diperbaiki

- Rujukan berbentuk singkatan kementerian (mis. "Permenkominfo 5/2020") selalu berakhir
  "tidak ditemukan" karena pencarian JDIH BPK mencocokkan judul, bukan bentuk singkat.
  Singkatan kini diterjemahkan ke nama kementerian untuk mencari, dan tetap dipakai sebagai
  jenis untuk memilih kandidat yang persis. Luput karena seluruh uji memakai rujukan UU.
- Direktori Putusan MA kini memasang tantangan Cloudflare untuk semua klien otomatis.
  Sebelumnya permintaan dicoba ulang beberapa kali dan berakhir dengan saran "coba lagi
  sebentar" yang menyesatkan. Kini dikenali dalam satu permintaan, tidak dicoba ulang, dan
  dinyatakan apa adanya: Pasla tidak menembus pembatasan ini.
- `riset_akad_syariah` memilih fatwa terbaru yang sekadar menyebut nama akad sebagai fatwa
  utama. Untuk "murabahah" yang terpilih 153/DSN-MUI/VI/2022 tentang pelunasan dipercepat,
  bukan fatwa yang mengatur akadnya. Kini fatwa berjudul akad itu sendiri ("Akad Jual Beli
  Murabahah", 111/DSN-MUI/IX/2017) didahulukan.

### Privasi

- `/v1/ask` tidak pernah mengirim pertanyaan mentah ke situs sumber. Tanpa AI tidak ada
  pencarian teks bebas sama sekali; dengan AI hanya kata kunci umum dari perencana (paling
  banyak enam kata, diperintahkan bebas data pribadi). Ditemukan sebelum rilis: versi awal
  mengirim pertanyaan utuh sebagai kata kunci JDIH BPK, dan halaman hasilnya yang memantulkan
  kata kunci itu tersimpan sehari di cache.

### Batas yang diketahui

- Dari server pusat data di Indonesia, situs MK dan JDIH MA menolak permintaan, dan
  Direktori Putusan MA memasang tantangan Cloudflare. Dari Azure Korea, JDIH BPK pun menolak.
  Ketiganya ditampilkan sebagai sumber yang belum tersedia di layanan web.

## [0.7.0] — 2026-09-06

### Kepercayaan dan keamanan

- Redirect HTTP kini manual dan setiap hop memvalidasi ulang DNS/host; IPv6 privat, metadata
  cloud, DNS rebinding, respons raksasa, dan redirect implisit curl memiliki uji regresi.
- Impor KHES dikurung di `HUKUM_IMPORT_ROOT` beserta pemeriksaan realpath/symlink dan tidak lagi
  membocorkan path lokal pada provenance.
- Dekripsi unggahan menegakkan pemilik pada batas repository dan selalu menghapus data key dari
  memori setelah dipakai.
- Exact lookup menyertakan alasan serta upaya yang dicoba; 41 rujukan palsu dan 10 pasal di luar
  rentang terbukti abstain tanpa memilih kandidat pertama.
- Klaim AI kini harus didukung isi tekstual evidence, bukan sekadar membawa evidence ID yang sah;
  perubahan nomor pasal atau penyisipan negasi/modalitas membuat validator abstain.
- Plaintext data key upload selalu di-zero-kan, termasuk bila Key Vault gagal membungkus kunci.

### Parser, kontrak, dan kinerja

- Ekstraksi PDF membedakan `ok`, `degraded`, dan `no_text_layer`, menjaga nomor halaman fisik,
  membaca dua kolom, serta memperingatkan teks Arab non-Unicode dan tanggal mustahil.
- Web client, REST, MCP stdio, dan remote MCP diuji menghasilkan evidence ID identik pada satu
  corpus release.
- Endpoint fail-closed `GET /v1/documents/{id}/articles/{article}` ditambahkan untuk exact lookup
  berlatensi rendah dan didokumentasikan di OpenAPI.
- Gate lokal 3 × 50 request menghasilkan error 0%, median p95 search 65,57 ms dan exact lookup
  58,77 ms tanpa egress.
- Tiga pengukuran Web mobile-medium menghasilkan LCP terburuk 2.192 ms dan INP terburuk 144 ms.

### Diketahui belum terselesaikan

- Status production-ready masih menunggu golden-set yang dinilai ahli, uji PDF decompression
  bomb dalam worker terisolasi, lifecycle Azure end-to-end, canary/rollback, dan alert staging.

## [0.6.0] — 2026-09-05

### Platform evidence-first

- Satu TypeScript strict legal core untuk Web, REST API v1, MCP `stdio`, dan remote MCP
  Streamable HTTP; default MCP dipadatkan menjadi sepuluh tool.
- Kontrak content-addressed `Evidence`, `LegalDocument`, `ResearchResult`, `SourceHealth`, dan
  `JobStatus`; klaim tanpa evidence terverifikasi dibuang dan hasil wajib abstain.
- Exact lookup fail-closed, pencarian PDF tidak lagi mengembalikan halaman tanpa keyword,
  validasi tanggal kalender, smoke exit code nonzero, dan HTTP client tahan SSRF/redirect/DNS
  rebinding/response bomb.
- Web research workspace responsif dengan source health, warning, filter, dan trace ID.
- Upload PDF/DOCX terenkripsi AES-256-GCM; data key unik dibungkus Key Vault RSA-OAEP-256,
  metadata di Table, pekerjaan di Queue, dan sweeper TTL 24 jam.
- Gemini 2.5 Flash opsional untuk sintesis evidence yang sudah diselesaikan server. BYOK tidak
  disimpan; consent unggahan diperiksa per dokumen.
- Release lexical/semantic index immutable dengan checksum, manifest-last, active pointer CAS,
  dan materialisasi disk atomik.
- Bicep untuk Azure Container Apps, Jobs, Static Web Apps, ACR, Key Vault, RBAC, Monitor, serta
  budget alert 50/75/90%; CI, canary deployment, dan rollback workflow ditambahkan.
- OpenAPI 3.1, ADR, runbook, launch gates, dan telemetry dengan route label terbatas tanpa query,
  token, API key, atau isi dokumen.

## [0.5.0] — 2026-09-05

### Lubang keilmuan terakhir tertutup

Naskah lengkap KHES akhirnya tersedia lewat `impor_khes`: Kompilasi Hukum Ekonomi Syari'ah
Edisi Revisi 2011 terbitan Direktorat Jenderal Badan Peradilan Agama Mahkamah Agung RI,
285 halaman, 779 pasal terdeteksi pada rentang 1-790. Naskahnya tidak ikut disebarkan
bersama perangkat ini; haknya ada pada Mahkamah Agung.

### Diperbaiki — struktur KHES yang selama ini keliru

Struktur buku sebelumnya diambil dari literatur sekunder dan ditandai belum diverifikasi.
Setelah dicocokkan ke naskah primer, **tiga dari empat batas ternyata salah**:

| Buku | Menurut literatur sekunder | Menurut naskah primer |
|---|---|---|
| I | 1-19 | 1-19 (benar) |
| II | 20-673 | **20-667** |
| III | 674-734 | **668-727** |
| IV | 735 ke atas | **728-790** |

Buktinya: Pasal 667 masih mengatur Dana Pensiun Syariah, Pasal 668 membuka Buku III dengan
definisi Infak, Pasal 727 masih hibah dan waris, dan Pasal 728 membuka Buku IV dengan
"Akuntansi syari'ah harus dilakukan dengan mencatat, mengelompokkan, dan menyimpulkan
transaksi". Pasal 790 adalah penutup tentang tanggung jawab hakim menggali hukum.

Ambang peringatan kelengkapan berkas ikut disesuaikan dari 700 menjadi 780.

Uji: 79 pemeriksaan, seluruhnya lulus. Uji KHES ditulis agar benar pada dua keadaan, sudah
diimpor maupun belum, karena naskahnya tidak dipaketkan.

## [0.4.1] — 2026-09-04

Hasil audit mendalam. Empat cacat ditemukan, seluruhnya kelas "kegagalan menyamar
sebagai keberhasilan" — jenis yang paling berbahaya bagi alat riset.

### Diperbaiki

- **`verifikasi_kutipan` tidak memeriksa pasal yang ditulis sebelum rujukan.** Sitasi
  Indonesia lazim menulis "Pasal 49 huruf i UU 3/2006", sedangkan penelusuran hanya maju.
  Akibatnya "Pasal 9999 UU 27/2022" pun dilaporkan **terverifikasi** padahal pasal itu tidak
  ada. Kini tiap pasal dilekatkan pada rujukan terdekat, dua arah.
- **`cari_perma` selalu nihil untuk rujukan singkat.** JDIH MA mencocokkan teks judul secara
  harfiah dan tidak konsisten menulis nomor: "PERMA NOMOR 2 TAHUN 2008" tetapi "SEMA NO. 02
  TAHUN 1994". Kini beberapa varian penulisan dicoba berurutan. Akibatnya `periksa_pasal`
  untuk PERMA, yang dijanjikan deskripsinya, kini benar-benar bekerja.
- **Pencarian hadis hanya menyapu satu kategori.** Diselidiki, lalu diverifikasi bahwa
  klaster muamalah (143 hadis) seluruhnya sudah termuat dalam kategori fikih — nol tambahan.
  Perubahan yang semula hendak memperluas justru dibatalkan, dan kategori sempit kini
  disediakan untuk MEMPERSEMPIT hasil agar lebih presisi.

### Ditambahkan — keamanan

- Pagar terhadap permintaan ke jaringan internal. Seluruh sumber hukum berada di internet
  publik, sehingga permintaan ke localhost, alamat privat, atau endpoint metadata tidak
  pernah sah — dan bisa berasal dari instruksi yang diselipkan dalam dokumen yang dibaca.
  Skema selain http dan https ditolak.
- Catatan keamanan pada `impor_khes`, yang membaca berkas di komputer pengguna: hanya
  dipanggil bila pengguna sendiri yang meminta, tidak pernah atas instruksi dari dokumen.

### Diverifikasi

- Seluruh sembilan kaidah fikih pada skill `qawaid-fiqhiyyah` dicocokkan ke kitab turats.
  Takhrij kaidah qardh diperkuat: *at-Tibyan fi Takhrij Ahadits Bulugh al-Maram* menilai
  "wa isnaduhu saqith" — sanadnya gugur, menegaskan statusnya kaidah, bukan hadis.
- Masukan kosong, cacat, dan bermusuhan diuji: seluruhnya ditolak dengan galat jelas atau
  dibatasi, tanpa ReDoS.

Uji: 76 pemeriksaan, seluruhnya lulus.

## [0.4.0] — 2026-09-04

### Ditambahkan — ketahanan

- `test/parser.test.js` — 20 pemeriksaan parser terhadap salinan HTML nyata di
  `test/fixtures/`, tanpa satu pun permintaan jaringan. Menahan kerusakan senyap ketika
  situs sumber berganti tampilan.
- `periksa_kesehatan_sumber` — menembak tiap sumber dengan kueri yang hasilnya sudah
  diketahui, lalu melaporkan sehat, lambat, membatasi, gagal_jaringan, atau
  berubah_struktur. Cache dilewati secara bawaan, karena pemeriksaan yang dilayani cache
  akan selalu tampak sehat meski situsnya sudah berubah.
- `npm test` menjalankan uji parser lalu uji asap; `prepublishOnly` memakainya.
- LICENSE MIT dengan pemisahan tegas antara lisensi kode dan kepemilikan isi dokumen hukum.
- README dwibahasa, panduan pemasangan, dan bagian Etika Pemakaian.
- `scripts/bangun-snapshot.js` untuk menyiapkan korpus inti yang dapat dibagikan.
- Integrasi berkelanjutan di `.github/workflows/uji.yml`. Uji parser berjalan pada setiap
  push di Node 20, 22, dan 24; uji asap yang menembak situs lembaga negara dijadwalkan
  seminggu sekali agar tidak membebani server publik demi kenyamanan pengembang.
- `CONTRIBUTING.md` — empat prinsip yang mengikat sumbangan, pola menambah sumber baru,
  urutan penanganan ketika situs sumber berganti tampilan, dan daftar hal yang tidak akan
  diterima.

### Diperbaiki

- **Pagination JDIH BPK tidak pernah terbaca.** HTML mentah menulis pemisah kueri sebagai
  `&amp;p=2`, sementara regex hanya mengenali `&p=2`, sehingga `total_halaman` selalu 1.
  Pada kueri uji, angka sebenarnya 3.560. Ditemukan oleh uji fixture, bukan oleh manusia.
- Probe kesehatan DSN semula memakai indeks yang tersimpan di memori proses, sehingga selalu
  tampak sehat tanpa benar-benar menyentuh sumber. Kini menembak halaman mentah.

## [0.3.0] — 2026-09-04

### Ditambahkan — kemampuan analitis

- `konsolidasi_peraturan` — menyusun jejak perubahan sebuah pasal lintas undang-undang
  perubahan, lalu menghasilkan rantai sitasi yang benar. JDIH BPK tidak menyediakan teks
  terkonsolidasi, sehingga mengutip dari naskah asli saja bisa keliru tanpa terlihat.
- `verifikasi_kutipan` — memeriksa seluruh sitasi dalam sebuah draf: keberadaan, status
  keberlakuan, nomor pasal, frasa yang dikutip, nomor perkara MK, dan nomor fatwa DSN.
- `hukum_pada_tanggal` — menyusun garis waktu keberlakuan dan menyimpulkan status sebuah
  peraturan pada tanggal tertentu.
- `daftar_periksa_akad` — mengekstrak butir ketentuan fatwa DSN-MUI menjadi daftar periksa
  kepatuhan akad. Sengaja tidak memutuskan sendiri butir mana yang terpenuhi.

### Ditambahkan — sumber

- `cari_pasal_khes` dan `impor_khes` — Kompilasi Hukum Ekonomi Syariah. Naskah primernya
  belum ditemukan dalam bentuk yang dapat diambil mesin, sehingga tool menolak dengan jelas
  dan menyediakan jalur impor berkas milik pengguna.
- `cari_hadis_berderajat`, `hadis_berderajat`, `daftar_kategori_hadis` — hadis lengkap
  dengan derajat kesahihan, takhrij, syarah, dan faedah dari Ensiklopedia Hadis Nabawi.
- `cari_produk_dsn` — pedoman implementasi dan ta'limat DSN-MUI.
- `cari_turats`, `penulis_turats` — verifikasi redaksi kaidah fikih ke kitab turats.
- `cari_perma` — PERMA, SEMA, dan KMA dari JDIH Mahkamah Agung, yang tidak terindeks di BPK.

### Ditambahkan — alur dan kinerja

- `periksa_pasal`, `cari_dalam_pdf`, `sisir_putusan_mk`, `riset_akad_syariah`.
- Cache berkas di disk dan cache teks hasil ekstraksi PDF. Rantai riset satu pasal turun
  dari sekitar 3.159 ms menjadi sekitar 30 ms pada panggilan berulang.
- Pemutus arus per host: sumber yang menolak dua permintaan beruntun dilewati cepat selama
  satu menit alih-alih menahan seluruh alur dengan retry.
- `scripts/bangun-snapshot.js` — membangun cache korpus inti agar dapat dibagikan.

### Diperbaiki

- Pencarian nomor perkara MK mencocokkan substring, sehingga `48/PUU-XXIII/2025` ikut
  mengembalikan `248/PUU-XXIII/2025`. Kini yang persis didahulukan dan diberi penanda.
- Pencarian hadis mencocokkan potongan kata, sehingga "riba" ikut cocok pada "beribadah".
  Kini pencocokan dilakukan sebagai kata utuh.
- `verifikasi_kutipan` sempat melekatkan pasal pada peraturan yang disebut lebih dulu dalam
  kalimat lain. Kini penelusuran maju dan berhenti di rujukan berikutnya.
- Tautan fatwa lama di Google Drive menuntut parameter `resourcekey`; tanpa itu Drive
  mengembalikan halaman masuk akun, bukan PDF.

### Diketahui belum terselesaikan

- Naskah lengkap KHES belum ditemukan dalam bentuk yang dapat diambil mesin.
- Pencarian teks-bebas Direktori Putusan Mahkamah Agung terkunci CAPTCHA.
- Lapisan teks sebagian PDF resmi cacat: teks Arab pada PDF fatwa DSN keluar rusak, dan
  digit kadang berubah — butir "176." pernah terbaca "t76.".
- Nomor putusan Mahkamah Agung belum dapat diverifikasi otomatis.
