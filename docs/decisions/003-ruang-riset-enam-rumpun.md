# ADR-003: Ruang riset enam rumpun dengan potongan bertanda tangan

- Status: diterima
- Tanggal: 2026-10-15
- Menggantikan: [ADR-002](002-azure-canonical-storage.md) untuk deployment Pasla

## Konteks

Pasla (pasla.tech) memakai mesin ini sebagai ruang riset bergaya Elicit yang sempit dan dalam
untuk enam rumpun kajian fakultas syariah dan hukum:

1. Ilmu Hukum
2. Hukum Ekonomi Syariah
3. Hukum Tata Negara
4. Hukum Keluarga Islam
5. Hukum Pidana Islam
6. Perbandingan Madzhab

Rilis pertamanya memuat Telusur, Laporan bersitasi, serta Pustaka dan Proyek, dengan akun
pengguna sejak awal.

ADR-002 memilih Azure Storage sebagai penyimpanan kanonik. Pilot Pasla tidak memakai Azure: mesin
berjalan di VPS di Indonesia (mode `pilot-vm`), karena JDIH BPK menolak permintaan dari pusat data
Azure di Korea, sementara Azure `indonesiacentral` tidak menyediakan ukuran VM yang berkuota untuk
langganan pemilik.

## Keputusan

1. **Mesin tetap tanpa status.** Mesin tidak menyimpan akun, pertanyaan, laporan, maupun kunci AI.
   Data pengguna (akun, proyek, pustaka, laporan) disimpan oleh aplikasi web di Cloudflare D1
   melalui Pages Functions pada origin pasla.tech. Rute unggah dan job v1 yang bergantung pada
   Azure tetap mati di mode `pilot-vm` (menjawab 503).
2. **Kunci AI milik pengguna (BYOK) hanya melintas.** Kunci dikirim per permintaan ke mesin lewat
   header `X-Pasla-AI-*`. Kunci tidak pernah dikirim ke Pages Functions dan tidak pernah disimpan
   di sisi mana pun.
3. **Bukti berupa potongan bertanda tangan.** Mesin memecah teks resmi menjadi potongan (pasal,
   ayat, paragraf) dengan offset dan sidik isi, lalu menandatanganinya dengan Ed25519. Langkah
   sintesis hanya menerima potongan bertanda tangan. Aplikasi web memeriksa tanda tangan sebelum
   menyimpan apa pun berlabel "terverifikasi". Klien tidak bisa memalsukan bukti.
4. **Validasi per kalimat.** Setiap kalimat sintesis membawa kutipan persis dari potongannya, lalu
   diperiksa terhadap kutipan itu sendiri:
   - negasi dan modalitas sejalan;
   - angka, nomor pasal, nomor peraturan, dan nomor putusan muncul di kutipan.
   Ringkasan bersifat ekstraktif. Kalimat yang dibuang disimpan bersama kode alasannya.
5. **Batas akses sumber dihormati.** Situs yang memasang tantangan Cloudflare, Turnstile, atau
   CAPTCHA tidak ditembus. Pada 15 Oktober 2026 ini berlaku untuk:
   - MK dan jdih.mkri.id;
   - Direktori Putusan MA;
   - JDIH MA.

   Penggantinya:
   - metadata putusan dari JDIHN;
   - putusan yang diunduh manusia lalu diimpor dengan sidik dan catatan asal;
   - unggahan pengguna, berlabel "belum dicocokkan dengan salinan resmi" kecuali sidiknya sama
     dengan berkas korpus;
   - permohonan akses resmi.

   Ketiadaan hasil karena sumber tidak dapat diperiksa tidak pernah ditulis sebagai "tidak ada".
6. **Waktu dan status bukti jujur.** `verified_live` hanya untuk teks yang baru diambil dari situs
   resmi. Teks dari cache selalu `verified_snapshot` dengan waktu ambil aslinya.

## Konsekuensi

- Mesin menyimpan kunci privat penandatangan di VPS (variabel lingkungan, di luar repositori).
  Kunci publiknya dipasang di aplikasi web. Rotasi kunci memerlukan masa tumpang tindih, yaitu dua
  kunci publik yang diterima sekaligus.
- Pekerjaan laporan diorkestrasi klien per langkah. Setiap langkah adalah satu permintaan yang
  respons streaming-nya mengirim header lebih dulu, sehingga batas 100 detik Cloudflare tidak
  memicu 524.
- Kode penyimpanan Azure (`src/storage/*`) dipertahankan untuk deployment non-Pasla. ADR-002 tetap
  berlaku di sana.
- Evaluasi otomatis memakai snapshot sumber luring dan id model yang dipatok. Penelaahan ahli
  menyusul setelah produk matang; sampai saat itu Pasla berstatus uji coba.
