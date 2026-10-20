# Pematangan materi — sedang dikerjakan

Kontrak kelulusan: `material-campaign-2026-10-20.json`. Paket ini terpisah dari evaluasi tertahan dan tidak mengubah quality gate rilis.

Urutan: register sumber dan 12 catatan → kurasi sumber → pemeriksaan dukungan dan penyajian → pengujian lokal/browser → preview → enam sintesis Azure nyata. Sumber yang belum tersedia tetap menghambat kelulusan bidang tersebut.

Baseline ledger dibaca ulang 20 Oktober: 24 reservasi, 297317 mikroUSD disisihkan; tersisa 702683 mikroUSD dan paling banyak 12 reservasi. Belum ada panggilan Azure baru dalam tahap ini. Tidak ada reset, refund kegagalan atau penggantian laporan untuk menghindari batas.

## Pemeriksaan analisis

Regresi awal membuktikan angka, kewajiban dan kesimpulan baru sebelumnya lolos melalui ID kalimat yang sah. Pengaman baru memeriksa teks bukti, bukan hanya ID. Analisis bebas yang tidak dapat dibuktikan ditolak dan dicatat; kutipan yang telah lolos dapat dirangkai utuh. Konsekuensinya sebagian parafrasa sah ikut ditolak. Kedalaman harus berasal dari pemilihan kutipan relevan dan hubungan yang tertulis dalam sumber; pengaman deterministik bukan pemeriksa makna hukum.

## Sumber dan hasil yang belum lulus

Register berversi: `material-source-register-2026-10-20.json` (12 rekaman). Berkas asli, hasil ekstraksi, jalur penemuan publik dan 12 catatan kasus ada pada output tugas `pasla-material-2026-10-20/`. Unduh berhasil bukan bukti kelulusan rubrik.

KHI: seluruh 52 gambar batang (PDF189–240) ditelaah dalam dua lintasan dengan konteks terpisah. Draf pendamping dan koreksi tersimpan; kerusakan karakter dan anomali sumber tetap terbuka, termasuk judul tercetak “Pasal16” antara115/117. Tidak diimpor; pemeriksaan1–229 dan batas buku tidak dilonggarkan. Jangan menandatangani draf ini sebagai transkripsi tuntas atau menormalkan isi dari ingatan.

Qanun12/2025: draf pendamping halaman15–20 sudah dibuat dari gambar. Lintasan kedua dan pemeriksaan visual penuh halaman1–14 belum selesai; tidak diimpor. Naskah asli dan pengubah tetap terpisah, tanpa konsolidasi otomatis.

PERMA2/2015 dan4/2019: PDF resmi berhasil diperoleh melalui tautan JDIH BPK. Jalur pembukaan preview belum lulus; urutan OCR PERMA2/2015 perlu kurasi sebelum impor.

Putusan33/PUU-XIV/2016: salinan resmi lengkap40halaman tersimpan; halaman relevan dapat dibuka secara eksplisit. Seluruh salinan belum dinyatakan lolos anonimisasi untuk impor.

Turath: pencarian Arab menemukan kitab6228 halaman internal335 (cetak351) dan kitab6172 halaman internal48 (cetak50). Metadata penulis/edisi dan versi transkripsi diperoleh dari endpoint primer. Rujukan baru terikat kitab/halaman; yang lama tetap didukung. Identitas kitab tidak membuktikan madzhab penulis maupun pendapat yang sedang dilaporkan.

## Implementasi dan verifikasi

- Mesin: `405dab2` mengikat analisis/cakupan pada bukti; `a5d2716` menambah pembukaan halaman kitab dan provenance transkripsi opsional bertanda tangan. Tidak ada migrasi D1 atau perubahan anggaran.
- Pengujian:148 uji unit mesin dan14 uji fixture evaluasi lulus; lint, OpenAPI, typecheck, build dan worker PDF hasil build lulus. Evaluasi tertahan tidak dibuka atau diubah.
- Web: alur tiga langkah tetap, membaca kutipan bertanda tangan tanpa AI, kekurangan bahan sebelum biaya, tambahan kueri Arab tanpa menghapus kueri, pilihan halaman putusan dan tautan putusan dari sumber, draf lama dipertahankan saat semua klaim baru ditolak.
-30 uji lokal web,44 uji worker akun,8 uji operasional,72 uji browser penuh dan2 uji tambahan halaman putusan lulus. Chromium/WebKit mencakup tema, layar sempit, keyboard, penyimpanan, reload, kutipan dan ekspor.
- WebKit sempat kehabisan waktu saat RAM lokal hampir habis; setelah pengguna menutup aplikasi, perjalanan kritis lulus13,5detik. Ini bukan pengukuran performa seluruh trafik.

## Pekerjaan lanjutan wajib

1. Selesaikan isu sumber KHI, kurasi PERMA2/2015 dan penjelasan Qanun; tinjau sebelum impor.
2. Lengkapi dua lintasan isi untuk12 kasus, termasuk terjemahan dan atribusi pendapat kitab yang dapat diikuti pengguna awam.
3. Pulihkan alat browser akun: reset masih menghasilkan `failed to write kernel assets: The system cannot find the path specified. (os error 3)`. Jangan membuat sesi palsu atau mengambil cookie dari profil browser.
4. Periksa ledger sebelum setiap panggilan; jalankan enam sintesis melalui sesi sah hanya setelah sumber cukup. Maksimum tambahan mengikuti sisa aktual, tidak lebih12.

Paket tetap **belum selesai**; tidak ada klaim12 kasus atau enam sintesis Azure telah lulus.
