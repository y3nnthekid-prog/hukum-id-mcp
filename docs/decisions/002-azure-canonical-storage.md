# ADR-002: Azure Storage sebagai penyimpanan kanonik

- Status: diterima
- Tanggal: 2026-09-05

## Keputusan

Storage Account Azure yang sudah ada menjadi sumber data utama. Blob menyimpan dokumen dan
release indeks, Table menyimpan metadata transaksional ringan, Queue mengantrekan job, dan
Key Vault membungkus kunci unggahan. Workload memakai Managed Identity; connection string dan
account key tidak masuk repository atau konfigurasi runtime.

## Alasan

Pilihan ini memakai aset Azure yang telah dimiliki, menghindari database tambahan pada pilot,
dan memungkinkan RBAC serta lifecycle yang konsisten.

## Konsekuensi

Operasi lintas Table/Blob/Queue bukan transaksi tunggal. Idempotency key, status job eksplisit,
checksum, compare-and-swap manifest, dan sweeper rekonsiliasi wajib dipertahankan.
