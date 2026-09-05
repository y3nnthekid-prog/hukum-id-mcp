import assert from "node:assert/strict";

import { periksaPasal } from "../src/alur.js";
import { simpan } from "../src/cache.js";
import { selectExactCandidate } from "../src/trust.js";
import { PDF_FIXTURES } from "./fixtures/pdf/index.js";

const corpus = [
  { id: "uu-21-2008", jenis: "UU", nomor: "21", tahun: "2008" },
  { id: "pp-72-1992", jenis: "PP", nomor: "72", tahun: "1992" },
  { id: "mk-48", jenis: "PUTUSAN MK", nomor: "48/PUU-XXIII/2025", tahun: "2025" },
  { id: "fatwa-04", jenis: "FATWA", nomor: "04/DSN-MUI/IV/2000", tahun: "2000" },
  { id: "uu-27", jenis: "UU", nomor: "27", tahun: "2022" },
  { id: "perbup-27", jenis: "PERBUP KAB KLATEN", nomor: "27", tahun: "2022" },
];

const nonexistent = [
  ...Array.from({ length: 15 }, (_, index) => ({
    label: `${["UU", "PP", "PERPRES"][index % 3]} ${999 - index}/${2099 - (index % 3)}`,
    input: { jenis: ["UU", "PP", "PERPRES"][index % 3], nomor: String(999 - index), tahun: String(2099 - (index % 3)) },
  })),
  ...Array.from({ length: 10 }, (_, index) => ({
    label: `Pasal ${9999 - index} UU 21/2008`,
    input: { jenis: "PASAL UU 21/2008", nomor: String(9999 - index), tahun: "2008" },
  })),
  ...Array.from({ length: 8 }, (_, index) => ({
    label: `${999 - index}/PUU-XXX/2099`,
    input: { jenis: "PUTUSAN MK", nomor: `${999 - index}/PUU-XXX/2099`, tahun: "2099" },
  })),
  ...Array.from({ length: 8 }, (_, index) => ({
    label: `${999 - index}/DSN-MUI/XII/2099`,
    input: { jenis: "FATWA", nomor: `${999 - index}/DSN-MUI/XII/2099`, tahun: "2099" },
  })),
];

assert.ok(nonexistent.length >= 40);
for (const reference of nonexistent) {
  const result = selectExactCandidate(corpus, reference.input);
  assert.notEqual(result.status, "matched", `${reference.label} tidak boleh cocok`);
  assert.equal(result.value, null, `${reference.label} tidak boleh membawa kandidat`);
  assert.match(result.reason, /tidak ditemukan|ambigu/i, `${reference.label} wajib menyebut alasan abstain`);
  assert.ok(result.attempted.length >= 3, `${reference.label} wajib mencatat filter yang dicoba`);
}

const collision = selectExactCandidate(corpus, { nomor: "27", tahun: "2022" });
assert.equal(collision.status, "ambiguous");
assert.match(collision.reason, /ambigu/i);
assert.ok(collision.attempted.some((entry) => /2 kandidat/i.test(entry)));

const narrowed = selectExactCandidate(corpus, { jenis: "UU", nomor: "27", tahun: "2022" });
assert.equal(narrowed.status, "matched");
assert.equal(narrowed.value.id, "uu-27");

const unknownType = selectExactCandidate(corpus, { jenis: "PERDA", nomor: "27", tahun: "2022" });
assert.equal(unknownType.status, "ambiguous");
assert.notEqual(unknownType.status, "not_found");

const searchUrl =
  "https://peraturan.bpk.go.id/Search?" +
  new URLSearchParams({ keywords: "UU", tentang: "", nomor: "21", jenis: "", entitas: "", tahun: "2008" }).toString();
const detailUrl = "https://peraturan.bpk.go.id/Details/39655";
const pdfUrl = "https://peraturan.bpk.go.id/Download/fixture-uu-21-2008.pdf";
await simpan(
  searchUrl,
  Buffer.from(
    '<div class="col-lg-10 fs-2 fw-bold pe-4"><a href="/Details/39655/uu-no-21-tahun-2008">' +
      "Undang-Undang Nomor 21 Tahun 2008 tentang Perbankan Syariah</a></div>"
  )
);
await simpan(
  detailUrl,
  Buffer.from(
    '<div class="col-lg-3 fw-bold">Judul</div><div class="col-lg-9">UU 21 Tahun 2008</div>' +
      '<div class="col-lg-3 fw-bold">Status</div><div class="col-lg-9">Berlaku</div>' +
      `<a data-label="UU 21/2008" data-kategori="Peraturan" href="/Download/fixture-uu-21-2008.pdf">PDF</a>`
  )
);
await simpan(pdfUrl, PDF_FIXTURES.peraturanPasalSatu);

for (let article = 9990; article < 10000; article++) {
  const result = await periksaPasal({
    peraturan: "UU 21/2008",
    pasal: `Pasal ${article}`,
    sertakan_putusan_mk: false,
  });
  assert.equal(result.status, "insufficient_evidence", `Pasal ${article} harus membuat alur abstain`);
  assert.equal(result.pasal?.ditemukan, false);
  assert.ok(result.pasal?.attempted?.some((entry) => entry.includes(`Pasal ${article}`)));
}

const missingSearchUrl =
  "https://peraturan.bpk.go.id/Search?" +
  new URLSearchParams({ keywords: "UU", tentang: "", nomor: "999", jenis: "", entitas: "", tahun: "2099" }).toString();
await simpan(missingSearchUrl, Buffer.from("<html><body>Tidak ada hasil</body></html>"));
const missingDocument = await periksaPasal({
  peraturan: "UU 999/2099",
  pasal: "Pasal 1",
  sertakan_putusan_mk: false,
});
assert.equal(missingDocument.status, "not_found");
assert.match(missingDocument.reason, /tidak ditemukan/i);
assert.ok(missingDocument.attempted.some((entry) => /nomor=999/.test(entry)));

console.log(
  `${nonexistent.length} rujukan palsu dan 10 pasal di luar rentang abstain tanpa kandidat salah; konflik jenis tetap fail-closed.`
);
