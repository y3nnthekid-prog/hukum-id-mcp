# Pematangan materi — sedang dikerjakan

Kontrak kelulusan: `material-campaign-2026-10-20.json`. Paket ini terpisah dari evaluasi tertahan dan tidak mengubah quality gate rilis.

Urutan: register sumber dan 12 catatan → kurasi sumber → pemeriksaan dukungan dan penyajian → pengujian lokal/browser → preview → enam sintesis Azure nyata. Sumber yang belum tersedia tetap menghambat kelulusan bidang tersebut.

Baseline ledger dibaca ulang 20 Oktober: 24 reservasi, 297317 mikroUSD disisihkan; tersisa 702683 mikroUSD dan paling banyak 12 reservasi. Belum ada panggilan Azure baru dalam tahap ini. Tidak ada reset, refund kegagalan atau penggantian laporan untuk menghindari batas.

## Pemeriksaan analisis

Regresi awal membuktikan angka, kewajiban dan kesimpulan baru sebelumnya lolos melalui ID kalimat yang sah. Pengaman baru memeriksa teks bukti, bukan hanya ID. Analisis bebas yang tidak dapat dibuktikan ditolak dan dicatat; kutipan yang telah lolos dapat dirangkai utuh. Konsekuensinya sebagian parafrasa sah ikut ditolak. Kedalaman harus berasal dari pemilihan kutipan relevan dan hubungan yang tertulis dalam sumber; pengaman deterministik bukan pemeriksa makna hukum.

## Sumber dan hasil yang belum lulus

Register berversi: `material-source-register-2026-10-20.json` (12 rekaman). Berkas asli, hasil ekstraksi, jalur penemuan publik dan 12 catatan kasus ada pada output tugas `pasla-material-2026-10-20/`. Unduh berhasil bukan bukti kelulusan rubrik.

KHI: seluruh 52 gambar batang (PDF189–240) ditelaah dalam dua lintasan dengan konteks terpisah. Draf pendamping dan koreksi tersimpan; kerusakan karakter dan anomali sumber tetap terbuka, termasuk judul tercetak “Pasal16” antara115/117. Tidak diimpor; pemeriksaan1–229 dan batas buku tidak dilonggarkan. Jangan menandatangani draf ini sebagai transkripsi tuntas atau menormalkan isi dari ingatan.

Qanun12/2025: seluruh20 halaman kini telah diperiksa dalam dua lintasan. Salah baca nomor50A/74A dan ayat1a dikoreksi berdasarkan gambar; tanda baca dan ejaan ganjil sumber dipertahankan. Transkripsi pendamping bertanda provenance sudah diuji pada salinan korpus terpisah. Naskah asli dan pengubah tetap terpisah, tanpa konsolidasi otomatis.

PERMA2/2015 dan4/2019: seluruh15 dan8 halaman telah ditelaah dua lintasan terhadap gambar resmi. Pendamping lengkap tersedia pada `corpus-reviewed/2026-10-20/`. PERMA4/2019 berotasi90; parser kini memetakan posisi teks melalui viewport di mesin dan browser. Naskah asli dan perubahan tidak dikonsolidasikan otomatis. Jalur live setelah pembaruan korpus masih harus diperiksa.

UU27/2022: lapisan teks halaman19 menghilangkan kata “menyampaikan” pada Pasal46. Kutipan lengkap Pasal46 dikurasi dari gambar dalam dua lintasan. Cakupannya hanya pasal itu, bukan seluruh halaman/UU/penjelasan. Judul OCR “PENJEI,ASAN” pada halaman35 kini dikenali sebagai batas bagian, sehingga penjelasan tidak disajikan sebagai norma. Teks asli tidak diubah oleh pengenalan batas ini.

Putusan33/PUU-XIV/2016: salinan resmi lengkap40halaman tersimpan; halaman relevan dapat dibuka secara eksplisit. Seluruh salinan belum dinyatakan lolos anonimisasi untuk impor.

Turath: pencarian Arab menemukan kitab6228 halaman internal335 (cetak351) dan kitab6172 halaman internal48 (cetak50). Metadata penulis/edisi dan versi transkripsi diperoleh dari endpoint primer. Rujukan baru terikat kitab/halaman; yang lama tetap didukung. Identitas kitab tidak membuktikan madzhab penulis maupun pendapat yang sedang dilaporkan.

## Implementasi dan verifikasi

- Mesin: `405dab2` mengikat analisis/cakupan pada bukti; `a5d2716` menambah pembukaan halaman kitab dan provenance transkripsi opsional bertanda tangan. Tidak ada migrasi D1 atau perubahan anggaran.
- Pengujian:148 uji unit mesin dan14 uji fixture evaluasi lulus; lint, OpenAPI, typecheck, build dan worker PDF hasil build lulus. Evaluasi tertahan tidak dibuka atau diubah.
- Web: alur tiga langkah tetap, membaca kutipan bertanda tangan tanpa AI, kekurangan bahan sebelum biaya, tambahan kueri Arab tanpa menghapus kueri, pilihan halaman putusan dan tautan putusan dari sumber, draf lama dipertahankan saat semua klaim baru ditolak.
-30 uji lokal web,44 uji worker akun,8 uji operasional,72 uji browser penuh dan2 uji tambahan halaman putusan lulus. Chromium/WebKit mencakup tema, layar sempit, keyboard, penyimpanan, reload, kutipan dan ekspor.
- WebKit sempat kehabisan waktu saat RAM lokal hampir habis; setelah pengguna menutup aplikasi, perjalanan kritis lulus13,5detik. Ini bukan pengukuran performa seluruh trafik.

## Pekerjaan lanjutan wajib

1. Selesaikan isu sumber KHI. Terapkan korpus yang telah ditelaah ke preview dan periksa jalur penemuan/pembukaan aktual.
2. Lengkapi dua lintasan isi untuk12 kasus, termasuk terjemahan dan atribusi pendapat kitab yang dapat diikuti pengguna awam.
3. Pulihkan alat browser akun: reset masih menghasilkan `failed to write kernel assets: The system cannot find the path specified. (os error 3)`. Jangan membuat sesi palsu atau mengambil cookie dari profil browser.
4. Periksa ledger sebelum setiap panggilan; jalankan enam sintesis melalui sesi sah hanya setelah sumber cukup. Maksimum tambahan mengikuti sisa aktual, tidak lebih12.

Paket tetap **belum selesai**; tidak ada klaim12 kasus atau enam sintesis Azure telah lulus.
