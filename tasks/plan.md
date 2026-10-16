# Penyelesaian rencana Pasla enam rumpun

Permintaan pemilik: selesaikan keseluruhan rencana utama 15 Oktober 2026. Cakupan mencakup
repo mesin ini dan repo saudara `../pasla`; keduanya diizinkan oleh permintaan tersebut.
Rencana utama dan ADR-003 tetap menjadi acuan. Tindakan akun pribadi, sumber yang perlu
disediakan manusia, dan rilis produksi tidak disamakan dengan pekerjaan kode yang selesai.

## Urutan dan kontrak

1. `corpus`: importer terikat root, metadata resmi, FTS5, provenance dan batas PDF.
2. `research-api`: profil rumpun, telusur tanpa AI, rencana, saring, sintesis, unggahan berlabel.
3. `identity-data`: OAuth Google PKCE/state, sesi, D1 dengan owner_id, tiket langkah dan versi.
4. `workspace`: IndexedDB lebih dulu, empat langkah laporan, pustaka/proyek, ekspor, akun.
5. `evaluation-release`: snapshot, garis dasar v1/v2, gerbang mutu, keamanan, browser, pratinjau.

Kontrak mesin memakai bahasa Indonesia untuk v2 dan JSON/NDJSON. Metadata pencarian tidak
pernah diperlakukan sebagai bukti isi. Hanya bukti/hasil bertanda tangan mesin dapat disimpan
sebagai terverifikasi. BYOK melintas langsung ke mesin, tidak ke Functions atau D1.

## Penerimaan

- Telusur bekerja tanpa akun/AI dan menampilkan cakupan terbatas serta sumber yang gagal dibuka.
- Laporan dapat disunting dan diulang per langkah; hasil berbayar disimpan lokal sebelum sinkron.
- Pemilik A tidak dapat mengakses data pemilik B. CSRF, pemalsuan tanda tangan, tiket, dan konflik
  versi ditolak. Privasi dan syarat tersedia sebelum pembukaan akun diaktifkan.
- Semua kalimat sintetis yang ditampilkan melewati validator; riwayat penolakan tetap tersedia.
- Rilis tidak dinyatakan lolos ketika sumber, kunci evaluasi, atau kalibrasi manusia belum ada.

## Verifikasi

Mesin: `npm run verify`, uji korpus/FTS, uji API v2, uji beban terukur, dan harness eval luring.
Web: unit/integrasi auth/data, `npm run typecheck`, `npm run build`, browser desktop/mobile,
alur laporan/ekspor/hapus, pratinjau HTTPS. Daftar rinci dan bukti ada di `tasks/todo.md`.

## Dependensi pemilik

OAuth client Google, Turnstile, pemasangan kunci produksi, naskah resmi KHI/PERMA, putusan
unduhan manusia, kunci AI evaluasi dan juri berbeda, label kalibrasi, NIB/PSE, pilihan paket
berbayar, serta persetujuan produksi. Pekerjaan independen tetap dilanjutkan saat ini belum ada.
