# Azure preview dan audit enam bidang

Plan pemilik disetujui 18 Oktober 2026. Implementasi hanya preview.

- [x] Adapter Azure tetap pasla-chat/GPT-5 mini 2025-08-07 low/4096; batas input, error aman, tanpa retry.
- [x] Tiket managed v2, konsumsi tahan restart, limiter satu aktif/65 detik; BYOK v1 tetap.
- [x] Proxy akun dan reservasi D1 atomik; seed 58.508 microUSD, plafon 1.000.000 microUSD.
- [x] Status AI dan pilihan managed/BYOK; lima tahap riset, biaya, jejak penolakan/metode.
- [x] Uji offline/backend/browser dan review terpisah; migrasi/deploy preview dalam keadaan nonaktif.
- [x] Aktif khusus pemilik setelah pemeriksaan akses, anggaran, kompatibilitas dan pin.
- [ ] Uji enam pertanyaan sintetis, maksimal 36 panggilan tambahan, semua kegagalan dihitung.
- [x] Matriks awal Elicit, biaya seed, rollback dan checkpoint operasional.
- [ ] Enam catatan hasil nyata dan laporan biaya akhir setelah uji preview.

Pertanyaan uji adalah enam pertanyaan pada plan pemilik, bukan set tertahan.
Kunci hanya di VPS, tidak masuk kode, browser, D1 atau log. Reservasi tak pasti tidak dikembalikan.

Checkpoint 19 Oktober: mesin 377f813 aktif, web preview Azure aktif untuk sole allowlist,
produksi tidak berubah. 42 uji Chromium/WebKit, 41 uji Workers, 8 uji operasi dan
uji lokal lulus. Paket enam bidang nyata belum berjalan: alat browser interaktif
gagal saat inisialisasi kernel; pemilik sudah menyatakan login di ChatGPT dan Brave.
Jangan meminta login lagi atau membuat sesi pengganti di D1 untuk melewati OAuth.
