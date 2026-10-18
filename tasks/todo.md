# Penerimaan dan bukti penyelesaian

- [x] Checkpoint 18 Oktober: verify lengkap 129 uji TypeScript; profil PDF 6.4.299
  selaras web, worker dist/exit/cache diperiksa, locator OCR dan identitas potongan
  berulang diperbaiki. Korpus lokal bertambah Qanun 7/2013, 6/2014 dan 12/2025;
  seluruhnya parsial, relasi perubahan ditandatangani. Lihat docs/riset-v2-preview.md.

- [x] Fondasi fase 0 dan integrasi tiga rute v2. Verify 104 uji, commit 2561519.
- [x] Checkpoint mesin 16 Oktober: profil/telusur, rencana/saring, tiket, FTS5/importer,
  worker PDF dan unggahan hash. `npm run verify` lulus 119 uji TypeScript dan seluruh rantai build.
  Rincian bukti serta celah korpus: `docs/riset-v2-preview.md`.
- [x] Checkpoint web lokal: 7 uji IndexedDB/ekspor, 16 uji Workers/OAuth/owner/tanda tangan,
  8 uji Chromium/WebKit. Pengujian HTTPS dan login Google nyata belum dilakukan.
- [ ] Profil enam rumpun dan telusur: lintas sumber, label otoritas/status, gagal terisolasi.
  Verifikasi: uji core dan API telusur; tidak ada model yang dipanggil.
- [ ] Rencana dan saring: BYOK, NDJSON, deterministik dulu, kutipan dan alasan, dapat disunting.
  Verifikasi: uji input palsu, sumber dicabut/gagal, hasil model tidak sah.
- [ ] Korpus: KHI, Qanun, metadata JDIHN, PDF MK BPK, putusan manual, FTS5, peta madzhab.
  Verifikasi: fixture parser, root/symlink, hash, pelabelan dan pencarian Arab/Indonesia.
- [ ] PDF/unggahan: batas byte/halaman/ekstraksi dan validasi unggahan tanpa label resmi palsu.
  Verifikasi: batas sumber daya, kecocokan hash, unggahan tidak tersimpan di server.
- [ ] Tiket langkah, kuota akun, batas token dan pembatalan di seluruh langkah berbayar.
  Verifikasi: tiket palsu/kedaluwarsa/ulang, batas laju dan anggaran.
- [ ] Akun Google dan D1 preview: PKCE/state, Turnstile, sesi, CSRF dan isolasi owner_id.
  Verifikasi: Workers/integrasi lokal, akses lintas akun, ekspor/hapus/keluar semua.
- [ ] IndexedDB dan alur laporan: attempt/hash/versi, invalidasi langkah, sinkron setelah simpan.
  Verifikasi: tab ditutup, konflik versi, perubahan rencana, hasil per bagian.
- [ ] UI ruang/telusur/laporan/pustaka/proyek/akun; cek pasal/sitasi dipertahankan.
  Verifikasi: keyboard, 320-1600 px, loading/galat/kosong, teks Arab dan dialog kutipan.
- [ ] Ekspor Markdown dan DOCX catatan kaki, serta unggah PDF lokal.
  Verifikasi: isi/sitasi/footer/RTL dan pembukaan berkas hasil ekspor.
- [ ] Privasi, syarat, DPIA, metodologi, kuota BYOK dan retensi selaras konfigurasi nyata.
  Verifikasi: pasal hukum diverifikasi lewat mesin, gerbang akun tertutup sebelum siap.
- [ ] Evaluasi snapshot v1/v2 dan gerbang mutu dengan interval kepercayaan.
  Verifikasi: set tertahan tetap terkunci, model dipatok, pengulangan dan juri terkalibrasi.
- [ ] Keamanan, build, browser WebKit, beban 450 MB, alert/retensi/rollback/backup.
  Verifikasi: seluruh perintah proyek dan laporan bukti tanpa kredensial.
- [ ] Pratinjau terpisah dan laporan rilis; produksi menunggu persetujuan pemilik.

### Bukti lanjutan 18 Oktober (gerbang keseluruhan tetap terbuka)

- [x] Rilis mesin `ac1bfba` aktif: korpus empat sumber + MK BPK halaman 25 dan
  tanda tangan dipatok lulus; v1 tidak berganti proses; rollback lama tersedia.
- [x] Beban campuran terisolasi 450 MiB: 6 PDF 112 halaman + 24 AI sintetis,
  30/30 selesai, nol biaya provider, dua PDF/delapan AI overlap; kedua PID tetap.
- [x] Backup preview terenkripsi dipulihkan ke D1 sementara; skema/count,
  integrity dan foreign key cocok; database uji dihapus, database lama utuh.
- [x] Login Google nyata setelah debugging dimatikan, profil dan sinkronisasi satu
  proyek sintetis sesudah reload; D1 versi 1 dikonfirmasi. Ekspor/logout nyata
  masih terbuka, sehingga gerbang akun keseluruhan belum dicentang.
- [x] Importer KHI menolak celah pasal/batas buku/isi kosong dan meminta kurasi
  daftar isi. Salinan Madiun kehilangan 124/139; tidak diimpor, indeks uji kosong.
- [ ] Naskah KHI utuh: lampiran perpustakaan MA yang ditemukan hanya pengantar/
  daftar isi pindai, tidak diimpor. Snapshot lain tetap parsial.
- [ ] Mutu model/juri/label manusia dan produksi belum dinyatakan lulus.
