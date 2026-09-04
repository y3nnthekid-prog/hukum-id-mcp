# Arsitektur HukumID 0.6

HukumID memakai satu legal core untuk tiga kanal: Web, REST API v1, dan MCP. Metadata hasil
pencarian bukan evidence. Klaim hukum baru boleh lolos ketika menunjuk `Evidence.id` yang
terverifikasi dan hash isinya cocok.

```text
Web (Static Web Apps) ─┐
REST client ───────────┼─> API + remote MCP (Container Apps, min 1)
Claude Code stdio ─────┘             │
                                     ├─ shared legal core
                                     ├─ connector resmi + live verification
                                     ├─ optional Gemini synthesis
                                     └─ Azure Storage/Key Vault

Scheduled/job queue ─────> Container Apps Jobs (scale to zero)
                           ├─ ingest/OCR/index build
                           ├─ atomic index release
                           └─ upload sweeper (hourly)
```

## Batas kepercayaan

- Sumber primer resmi didahulukan; literatur dan doktrin selalu dilabeli sumber sekunder.
- Al-Qur'an, hadis, dan turats adalah sumber normatif/keilmuan sesuai konteks, bukan otomatis
  peraturan negara.
- Exact lookup gagal tertutup. Rujukan ambigu menghasilkan kandidat, tidak memilih hasil
  pertama.
- Dokumen pengguna dan isi dokumen sumber diperlakukan sebagai data tidak tepercaya.
- Sintesis AI hanya menerima evidence yang sudah diselesaikan server dari ID-nya. Keluaran
  model divalidasi ulang; klaim tanpa evidence dibuang.
- Telemetri hanya memakai route template dan status class. Query string, ID dokumen, isi
  pertanyaan, token, API key, serta isi dokumen tidak dicatat.

## Penyimpanan

Azure Blob adalah sumber kanonik. Container privatnya: `corpus-raw`, `corpus-derived`,
`index-releases`, `user-uploads`, dan `exports`. Azure Table menyimpan metadata job dan
idempotensi; Azure Queue membawa pekerjaan. Akses produksi memakai user-assigned Managed
Identity dan RBAC.

Unggahan memakai AES-256-GCM dengan data key unik. Data key dibungkus RSA-OAEP-256 oleh Key
Vault. Sweeper menghapus blob serta metadata maksimal satu jam setelah TTL 24 jam; hilangnya
wrapped key menghasilkan cryptographic erasure walau soft-delete Azure masih menyimpan blob.

## Indeks

Release memuat `lexical.sqlite`, `semantic.hnsw`, dan manifest checksum. Semua connector wajib
sehat, seluruh file diverifikasi, lalu objek immutable diunggah. `active.json` baru diganti
dengan compare-and-swap setelah manifest selesai. Container mengunduh release ke staging,
memverifikasi ulang checksum, dan melakukan rename direktori secara atomik.

## Status implementasi

Versi 0.6 adalah fondasi pilot yang dapat dibangun dan diuji: core evidence, 10 MCP tool,
REST v1, Web search workspace, upload terenkripsi, AI evidence-first, atomic index release,
IaC, CI, canary, rollback, dan telemetri aman. OCR worker, builder SQLite FTS5/HNSW produksi,
akun/proyek/kuota persisten, workspace riset tersimpan, ontology graph HES lengkap, serta
golden-set 300 query masih menjadi quality gates sebelum label production-ready.
