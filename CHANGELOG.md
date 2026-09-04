# Catatan Perubahan

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/), versi mengikuti
[Semantic Versioning](https://semver.org/lang/id/). Peneliti disarankan menyebutkan versi
alat ini dalam tulisannya demi reproduktibilitas.

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
