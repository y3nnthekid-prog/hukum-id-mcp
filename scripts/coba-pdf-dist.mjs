import assert from "node:assert/strict";
import { extractPdfIsolated } from "../dist/pdf.js";
import { PDF_FIXTURES } from "../test/fixtures/pdf/index.js";
const result = await extractPdfIsolated(new Uint8Array(PDF_FIXTURES.duaKolom));
assert.equal(result.total_halaman, 1);
assert.match(result.halaman[0].teks, /KIRI BARIS SATU/);
console.log("PASS ekstraksi PDF dari dist memuat worker hasil build.");
