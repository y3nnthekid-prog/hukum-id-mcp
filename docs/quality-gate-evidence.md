# Bukti penutupan quality gate 0.7.0

Catatan ini membedakan gate yang dibuktikan secara deterministik dari gate yang masih
memerlukan ahli atau staging Azure. Semua fixture berjalan tanpa mengambil data dari situs
pemerintah.

| Gate | Bukti | Hasil |
|---|---|---|
| Exact lookup fail-closed | `npm run test:abstain` | 41 rujukan palsu lintas jenis dan 10 pasal di luar rentang seluruhnya abstain, dengan alasan dan langkah yang dicoba. |
| Klaim AI berbukti | `test/ai-synthesis.test.ts` | Klaim fiktif, nomor pasal yang diubah, dan negasi yang disisipkan tetap dibuang walau menunjuk evidence ID nyata; hasil `insufficient_evidence`. |
| PDF sulit | `npm run test:parser` | 25 pemeriksaan termasuk scan tanpa text layer, dua kolom, halaman kosong, Arab non-Unicode, dan 31 Februari. |
| Kontrak lintas kanal | `test/mcp-contract.test.ts` | Web client, REST, MCP stdio, dan remote Streamable HTTP mempertahankan evidence ID yang sama pada `fixture-release-2026-09-06`. |
| Beban API | `npm run test:load` | Tiga gelombang × 50 request per jalur; error 0%; median p95 search 65,57 ms, exact 58,77 ms; egress 0. |
| Web vitals | `npm run test:web-vitals` | Tiga browser independen; LCP terburuk 2.192 ms, INP terburuk 144 ms; egress 0. |
| Regresi keseluruhan | `npm run verify` | Lint, OpenAPI, seluruh test deterministik, TypeScript strict, build API dan Web lulus. |

## Cacat yang ditemukan

- HTTP transport sebelumnya belum memberi bukti bahwa DNS divalidasi ulang pada tiap hop,
  curl tidak mengikuti redirect, dan declared/streamed response bomb selalu dipotong.
- Impor KHES menerima path tanpa confinement terhadap root dan realpath; provenance juga
  berisiko membocorkan path lokal.
- Dekripsi upload mengambil record hanya berdasarkan ID sehingga kepemilikan tidak ditegakkan
  pada batas repository.
- Exact lookup tidak selalu membawa alasan serta daftar upaya, dan lookup pasal yang tidak
  ditemukan belum konsisten berakhir sebagai `insufficient_evidence`.
- Validator klaim hanya memeriksa keberadaan evidence ID, bukan apakah teks evidence benar-benar
  mendukung proposisi; overlap longgar juga sempat menerima nomor pasal dan negasi yang berubah.
- Plaintext data key belum di-zero-kan bila proses pembungkusan kunci gagal sebelum upload.
- Empat kanal belum pernah dibandingkan pada satu rilis korpus yang sama.
- Target p95 exact tidak realistis bila dipaksakan lewat pembuatan server MCP stateless untuk
  setiap request. Endpoint REST exact yang tipis kini memanggil legal core yang sama; baseline
  remote MCP 470,99 ms tetap dicatat sebagai utang optimasi.

## Gate yang belum ditutup

- 300 golden query dan recall/akurasi locator harus dinilai ahli hukum nasional dan ahli HES.
- PDF decompression bomb masih membutuhkan worker terisolasi dengan batas memori/waktu; batas
  upload 25 MB saja belum cukup membuktikan ketahanan terhadap rasio dekompresi ekstrem.
- Lifecycle seluruh blob turunan dan cache setelah 24 jam harus dibuktikan end-to-end di Azure.
- Canary, rollback, alert, budget, dan observability harus diuji pada langganan Azure aktif.

Selama daftar ini belum kosong, kandidat 0.7.0 bukan production-ready.
