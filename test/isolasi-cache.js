// Diimpor PALING ATAS oleh uji yang menyemai cache dengan fixture. Cache dipindah ke folder
// sementara sebelum src/cache.js dievaluasi, supaya fixture tidak pernah masuk cache riset
// sungguhan (~/.cache/hukum-id-mcp). Sebelum 0.8.2, abstain.test.js dan parser.test.js menulis
// halaman palsu untuk UU 21/2008 dan pencarian JDIH BPK ke cache itu.
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HUKUM_CACHE_DIR = mkdtempSync(path.join(os.tmpdir(), "hukum-uji-"));
delete process.env.HUKUM_CACHE_BEKU;
delete process.env.HUKUM_LURING;
