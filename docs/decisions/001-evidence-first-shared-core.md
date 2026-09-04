# ADR-001: Shared legal core dan evidence-first

- Status: diterima
- Tanggal: 2026-09-05

## Keputusan

Web, REST, local MCP, dan remote MCP harus memanggil implementasi core yang sama. Setiap
proposisi hukum dalam `ResearchResult.claims` wajib menunjuk satu atau lebih `Evidence.id`.
Evidence hanya mendukung klaim bila berstatus `verified_live` atau `verified_snapshot`.
Status `ambiguous`, `conflicting`, dan `insufficient_evidence` tidak boleh dinaikkan menjadi
simpulan oleh UI, API, MCP, atau model AI.

## Alasan

Duplikasi logika antar-kanal menghasilkan perbedaan hasil dan sulit diaudit. Kontrak evidence
yang content-addressed membuat sumber, locator, versi indeks, dan teks dapat direproduksi.

## Konsekuensi

Metadata pencarian tidak cukup untuk analisis. Kualitas jawaban kadang terasa lebih konservatif,
tetapi kegagalan terlihat dan klaim fiktif dapat ditolak secara mekanis.
