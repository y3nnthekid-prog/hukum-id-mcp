# Catatan Perubahan

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/), versi mengikuti
[Semantic Versioning](https://semver.org/lang/id/). Peneliti disarankan menyebutkan versi
alat ini dalam tulisannya demi reproduktibilitas.

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
